#include <stdio.h>
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "driver/i2c.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "nvs_flash.h"
#include "mqtt_client.h"
#include "time.h"
#include "freertos/queue.h"
#include "esp_sntp.h"
#include "esp_timer.h"

// Biến toàn cục
static const char *TAG = "Ctr";
static int w_retry = 0;
static int mqtt_retry = 0;

esp_mqtt_client_handle_t mqtt_client;
EventGroupHandle_t system_event_group;
#define WIFI_CONNECTED_BIT BIT0
#define MQTT_CONNECTED_BIT BIT1

// Cấu hình Wifi
#define WIFI_SSID "E"
#define WIFI_PASS "bxgb6539"
#define WIFI_MAXIMUM_RETRY 1000

// Cấu hình mqtt
#define MQTT_BROKER "mqtt://broker.hivemq.com:1883"
#define MQTT_MAXIMUM_RETRY 100

//  Thông tin I2C
#define I2C_MASTER_SCL_IO 22
#define I2C_MASTER_SDA_IO 21
#define I2C_MASTER_NUM I2C_NUM_0
#define I2C_MASTER_FREQ_HZ 100000
#define I2C_MASTER_TX_BUF_DISABLE 0
#define I2C_MASTER_RX_BUF_DISABLE 0
// Địa chỉ cảm biến
#define BH1750_ADDR 0x23 // hoặc 0x5C nếu ADDR nối VCC
                         // Các lệnh BH1750
#define BH1750_POWER_ON 0x01
#define BH1750_RESET 0x07
#define BH1750_CONT_H_RES_MODE 0x10 // Chế độ đo liên tục độ phân giải cao

typedef struct
{
    float lux;
    time_t time;
} lux_data;
#define QUEUE_LENGTH 1800
#define QUEUE_ITEM_SIZE sizeof(lux_data)
#define READ_INTERVAL_MS 2000
static QueueHandle_t lux_queue; // lux_queue

static time_t last_timestamp = 0;
static int64_t last_tick_us = 0; // esp_timer at last valid timestamp

time_t get_current_time()
{
    time_t now;
    time(&now);

    if (now >= 1000000000)
    { // NTP đã sync
        last_timestamp = now;
        last_tick_us = esp_timer_get_time();
        return now;

    } // NTP fail fallback
    if (last_timestamp > 0)
    {
        int64_t delta_us = esp_timer_get_time() - last_tick_us;
        return last_timestamp + delta_us / 1000000;
    } // Lần đầu tiên, chưa sync NTP
    return esp_timer_get_time() / 1000000;
}

// Hàm khởi tạo I2C cho ÉP32(master)
static esp_err_t i2c_master_init(void)
{
    i2c_config_t conf = {
        .mode = I2C_MODE_MASTER,
        .sda_io_num = I2C_MASTER_SDA_IO,
        .scl_io_num = I2C_MASTER_SCL_IO,
        .sda_pullup_en = GPIO_PULLUP_ENABLE,
        .scl_pullup_en = GPIO_PULLUP_ENABLE,
        .master.clk_speed = I2C_MASTER_FREQ_HZ,
    };
    ESP_ERROR_CHECK(i2c_param_config(I2C_MASTER_NUM, &conf)); // check lỗi, gửi cấu hình đén drive I2C
    return i2c_driver_install(I2C_MASTER_NUM, conf.mode,      // cai dat drive I2C
                              I2C_MASTER_RX_BUF_DISABLE,
                              I2C_MASTER_TX_BUF_DISABLE, 0);
}

esp_err_t bh1750_write_cmd(uint8_t cmd)
{
    i2c_cmd_handle_t handle = i2c_cmd_link_create(); // chuỗi lệnh I2C
    i2c_master_start(handle);
    i2c_master_write_byte(handle, (BH1750_ADDR << 1) | I2C_MASTER_WRITE, true); // lùi 1 bit , W, ACK
    i2c_master_write_byte(handle, cmd, true);                                   // bit lệnh
    i2c_master_stop(handle);                                                    // kết thúc giao tiếp
    esp_err_t ret = i2c_master_cmd_begin(I2C_MASTER_NUM, handle, pdMS_TO_TICKS(1000));
    i2c_cmd_link_delete(handle); // xóa handle
    return ret;                  // OK or Error
}

// Đọc giá trị ánh sáng
float bh1750_read_lux()
{
    uint8_t data[2]; // 2 byte raw
    i2c_cmd_handle_t handle = i2c_cmd_link_create();
    i2c_master_start(handle);                                                  // start
    i2c_master_write_byte(handle, (BH1750_ADDR << 1) | I2C_MASTER_READ, true); // lùi 1 bit , R, ACK
    i2c_master_read(handle, data, 2, I2C_MASTER_LAST_NACK);                    // 2 byte, NACK(kết thúc read)
    i2c_master_stop(handle);
    esp_err_t ret = i2c_master_cmd_begin(I2C_MASTER_NUM, handle, pdMS_TO_TICKS(1000)); // Thực thi lệnh đọc
    i2c_cmd_link_delete(handle);

    if (ret != ESP_OK)
    {
        ESP_LOGE(TAG, "Loi doc du lieu BH1750");
        return -1;
    }

    uint16_t raw = (data[0] << 8) | data[1];
    float lux = raw / 1.2; // theo datasheet BH1750
    return lux;
}

// ntp
void time_ntp(void)
{
    ESP_LOGI(TAG, "Đang đồng bộ thời gian NTP...");
    esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
    esp_sntp_setservername(0, "vn.pool.ntp.org");
    esp_sntp_init();
}

// WIFI
static void wifi_event_handler(void *arg, esp_event_base_t event_base,
                               int32_t event_id, void *event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START)
    {
        esp_wifi_connect();
    }
    else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED)
    {
        if (w_retry < WIFI_MAXIMUM_RETRY)
        {
            esp_wifi_connect();
            w_retry++;
            ESP_LOGW(TAG, "Retrying WiFi... (%d/%d)", w_retry, WIFI_MAXIMUM_RETRY);
        }
        else
        {
            ESP_LOGE(TAG, "Ket noi that bai");
        }
        xEventGroupClearBits(system_event_group, WIFI_CONNECTED_BIT);
    }
    else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP)
    {
        w_retry = 0;
        ESP_LOGI(TAG, "WiFi got IP");
        xEventGroupSetBits(system_event_group, WIFI_CONNECTED_BIT);
        time_ntp();
        if (mqtt_client != NULL && !(xEventGroupGetBits(system_event_group) & MQTT_CONNECTED_BIT))
        {
            ESP_LOGI(TAG, "Reconnecting MQTT...");
            esp_mqtt_client_reconnect(mqtt_client);
        }
    }
}
void wifi_init_sta()
{
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL);
    esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL);

    wifi_config_t wifi_config = {
        .sta = {
            .ssid = WIFI_SSID,
            .password = WIFI_PASS,
        },
    };

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_LOGI(TAG, "WiFi init");
}

// MQTT
static void mqtt_event_handler(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data)
{
    esp_mqtt_event_id_t evt = (esp_mqtt_event_id_t)event_id;
    if (evt == MQTT_EVENT_CONNECTED)
    {
        ESP_LOGI(TAG, "MQTT CONNECTED");
        mqtt_retry = 0;
        xEventGroupSetBits(system_event_group, MQTT_CONNECTED_BIT);
    }
    else if (evt == MQTT_EVENT_DISCONNECTED)
    {
        ESP_LOGW(TAG, "MQTT DISCONNECTED");
        xEventGroupClearBits(system_event_group, MQTT_CONNECTED_BIT);
    }
}
void mqtt_start()
{
    esp_mqtt_client_config_t cfg = {
        .broker.address.uri = MQTT_BROKER,
    };
    mqtt_client = esp_mqtt_client_init(&cfg);
    esp_mqtt_client_register_event(mqtt_client, ESP_EVENT_ANY_ID, mqtt_event_handler, NULL);
    esp_mqtt_client_start(mqtt_client);
}

// Doc gia tri anh sang va ghi vao buffer
void Luxntime_read(void *pvParameters)
{
    while (1)
    {

        time_t now = get_current_time();
        float lux = bh1750_read_lux();
        if (lux >= 0 && lux < 5000)
        {
            lux_data data;
            data.lux = lux;
            data.time = now;
            if (xQueueSend(lux_queue, &data, 0) != pdPASS)
            {
                ESP_LOGW(TAG, "Queue đầy");
            }
            else
            {
                ESP_LOGI(TAG, "Lux: %.2f, Time: %lld (queued)", lux, (long long)now);
            }
        }

        vTaskDelay(pdMS_TO_TICKS(READ_INTERVAL_MS));
    }
}
// Publish len mqtt
void mqtt_publish_task(void *pvParameters)
{
    lux_data item;

    while (1)
    {
        {
            // Đợi MQTT connect
            EventBits_t bits = xEventGroupGetBits(system_event_group);
            if (!(bits & MQTT_CONNECTED_BIT))
            {
                ESP_LOGW(TAG, "MQTT chưa sẵn sàng, chờ 1s...");
                vTaskDelay(pdMS_TO_TICKS(1000));
                continue;
            }
            // Nhận 1 phần tử từ queue (đợi tối đa 1s)
            if (xQueueReceive(lux_queue, &item, pdMS_TO_TICKS(1000)) == pdPASS)
            {
                char msg[128];
                snprintf(msg, sizeof(msg),
                         "{\"lux\": %.2f, \"time\": %lld}",
                         item.lux, (long long)item.time);

                int msg_id = esp_mqtt_client_publish(
                    mqtt_client,
                    "esp32/luxbh1750", msg, 0, 1, 0);

                if (msg_id >= 0)
                {
                    ESP_LOGI(TAG, "Đã publish: %s", msg);
                }
                else
                {
                    ESP_LOGW(TAG, "Publish thất bại , gửi lại lên đầu queue");
                    xQueueSendToFront(lux_queue, &item, 0);
                    vTaskDelay(pdMS_TO_TICKS(1000));
                }
            }
            else
            {
                vTaskDelay(pdMS_TO_TICKS(500));
            }
        }
    }}

    // app_main
    void app_main(void)
    {
        ESP_ERROR_CHECK(nvs_flash_init());
        system_event_group = xEventGroupCreate();
        lux_queue = xQueueCreate(QUEUE_LENGTH, QUEUE_ITEM_SIZE);
        if (lux_queue == NULL)
        {
            ESP_LOGE(TAG, "Không tạo được queue");
            return;
        }
        wifi_init_sta();
        ESP_ERROR_CHECK(i2c_master_init());
        bh1750_write_cmd(BH1750_POWER_ON);
        bh1750_write_cmd(BH1750_RESET);
        bh1750_write_cmd(BH1750_CONT_H_RES_MODE);
        ESP_LOGI(TAG, "Khởi tạo I2C và BH1750 thành công");

        // xEventGroupWaitBits(system_event_group, WIFI_CONNECTED_BIT, false, true, portMAX_DELAY);

        mqtt_start();
        // Tạo Task đọc cảm biến và publish
        xTaskCreatePinnedToCore(Luxntime_read, "Luxntime_read", 4096, NULL, 5, NULL, 0);
        xTaskCreatePinnedToCore(mqtt_publish_task, "mqtt_publish_task", 8192, NULL, 6, NULL, 0);
    }
