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

// Biến toàn cục & Cấu hình
static const char *TAG = "Ctr";

esp_mqtt_client_handle_t mqtt_client = NULL;
EventGroupHandle_t system_event_group;
#define WIFI_CONNECTED_BIT BIT0
#define MQTT_CONNECTED_BIT BIT1

// Cấu hình Wifi (Thay thế bằng thông tin thực tế của bạn)
#define WIFI_SSID "E"
#define WIFI_PASS "bxgb6539"
#define WIFI_MAXIMUM_RETRY 1000

// Cấu hình mqtt
#define MQTT_BROKER_URI "mqtt://broker.hivemq.com:1883"

// Thông tin I2C
#define I2C_MASTER_SCL_IO 22
#define I2C_MASTER_SDA_IO 21
#define I2C_MASTER_NUM I2C_NUM_0
#define I2C_MASTER_FREQ_HZ 100000
// Địa chỉ cảm biến
#define BH1750_ADDR 0x23
// Các lệnh BH1750
#define BH1750_POWER_ON 0x01
#define BH1750_RESET 0x07
#define BH1750_CONT_H_RES_MODE 0x10 // Chế độ đo liên tục độ phân giải cao

// Cấu trúc dữ liệu và Queue
typedef struct
{
    float lux;
    time_t time;
} lux_data;

#define READ_INTERVAL_MS 2000
#define QUEUE_LENGTH 1800 // Khoảng 1 giờ lưu trữ (1800 * 2s)
#define QUEUE_ITEM_SIZE sizeof(lux_data)
static QueueHandle_t lux_queue;

static time_t last_timestamp = 0;
static int64_t last_tick_us = 0;

// --- Hàm Hỗ Trợ Thời Gian ---
time_t get_current_time()
{
    time_t now;
    time(&now);

    // Kiểm tra xem NTP đã đồng bộ chưa (thời gian Unix time bắt đầu từ 1/1/1970)
    if (now >= 1000000000)
    {
        last_timestamp = now;
        last_tick_us = esp_timer_get_time();
        return now;
    }

    // NTP fail, sử dụng thời gian fallback dựa trên last_timestamp và esp_timer
    if (last_timestamp > 0)
    {
        int64_t delta_us = esp_timer_get_time() - last_tick_us;
        return last_timestamp + delta_us / 1000000;
    }

    // Lần đầu tiên, chưa sync NTP, trả về thời gian ước tính dựa trên timer
    return esp_timer_get_time() / 1000000;
}

// --- Hàm I2C/BH1750 ---

// Hàm khởi tạo I2C cho ESP32 (master)
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
    ESP_ERROR_CHECK(i2c_param_config(I2C_MASTER_NUM, &conf));
    return i2c_driver_install(I2C_MASTER_NUM, conf.mode,
                              I2C_MASTER_RX_BUF_DISABLE,
                              I2C_MASTER_TX_BUF_DISABLE, 0);
}

// Gửi lệnh BH1750
esp_err_t bh1750_write_cmd(uint8_t cmd)
{
    i2c_cmd_handle_t handle = i2c_cmd_link_create();
    i2c_master_start(handle);
    // Địa chỉ cảm biến (0x23) << 1 bit + bit Write (0)
    i2c_master_write_byte(handle, (BH1750_ADDR << 1) | I2C_MASTER_WRITE, I2C_MASTER_ACK);
    i2c_master_write_byte(handle, cmd, I2C_MASTER_ACK);
    i2c_master_stop(handle);
    esp_err_t ret = i2c_master_cmd_begin(I2C_MASTER_NUM, handle, pdMS_TO_TICKS(100));
    i2c_cmd_link_delete(handle);
    return ret;
}

// Đọc giá trị ánh sáng
float bh1750_read_lux()
{
    uint8_t data[2];
    esp_err_t ret;

    // 1. Gửi lệnh đo liên tục độ phân giải cao để kích hoạt đo lường
    ret = bh1750_write_cmd(BH1750_CONT_H_RES_MODE);
    if (ret != ESP_OK)
    {
        ESP_LOGE(TAG, "BH1750: Khong gui duoc lenh do - %d", ret);
        return -1;
    }
    vTaskDelay(pdMS_TO_TICKS(180)); // Đợi thời gian đo (120ms max cho H-res mode, dùng 180ms an toàn)

    // 2. Đọc dữ liệu
    i2c_cmd_handle_t handle = i2c_cmd_link_create();
    i2c_master_start(handle);
    // Địa chỉ cảm biến (0x23) << 1 bit + bit Read (1)
    i2c_master_write_byte(handle, (BH1750_ADDR << 1) | I2C_MASTER_READ, I2C_MASTER_ACK);
    i2c_master_read(handle, data, 2, I2C_MASTER_LAST_NACK);
    i2c_master_stop(handle);

    ret = i2c_master_cmd_begin(I2C_MASTER_NUM, handle, pdMS_TO_TICKS(100));
    i2c_cmd_link_delete(handle);

    if (ret != ESP_OK)
    {
        ESP_LOGE(TAG, "BH1750: Loi doc du lieu - %d", ret);
        return -1;
    }

    uint16_t raw = (data[0] << 8) | data[1];
    float lux = raw / 1.2;
    return lux;
}

// --- Hàm NTP ---
void time_ntp_start(void)
{
    ESP_LOGI(TAG, "Dang dong bo thoi gian NTP...");
    setenv("TZ", "GMT+7", 1); // Đặt múi giờ Việt Nam
    tzset();

    esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
    esp_sntp_setservername(0, "vn.pool.ntp.org");
    esp_sntp_init();
}

// --- Hàm WIFI ---
static void wifi_event_handler(void *arg, esp_event_base_t event_base,
                               int32_t event_id, void *event_data)
{
    static int s_retry_num = 0;

    if (event_base == WIFI_EVENT)
    {
        if (event_id == WIFI_EVENT_STA_START)
        {
            esp_wifi_connect();
        }
        else if (event_id == WIFI_EVENT_STA_DISCONNECTED)
        {
            if (s_retry_num < WIFI_MAXIMUM_RETRY)
            {
                esp_wifi_connect();
                s_retry_num++;
                ESP_LOGW(TAG, "Retrying WiFi... (%d/%d)", s_retry_num, WIFI_MAXIMUM_RETRY);
            }
            else
            {
                ESP_LOGE(TAG, "Ket noi WiFi that bai, dung retry.");
            }
            xEventGroupClearBits(system_event_group, WIFI_CONNECTED_BIT);
            xEventGroupClearBits(system_event_group, MQTT_CONNECTED_BIT); // Clear MQTT bit luôn
        }
    }
    else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP)
    {
        s_retry_num = 0;
        ESP_LOGI(TAG, "WiFi got IP. Khoi dong NTP va MQTT Reconnect.");
        xEventGroupSetBits(system_event_group, WIFI_CONNECTED_BIT);

        time_ntp_start();

        // Luôn cố gắng reconnect MQTT sau khi có IP (nếu chưa connected)
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

    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL));

    wifi_config_t wifi_config = {
        .sta = {
            .ssid = WIFI_SSID,
            .password = WIFI_PASS,
            .threshold.authmode = WIFI_AUTH_WPA2_PSK, // Thiết lập chế độ bảo mật
        },
    };

    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_LOGI(TAG, "WiFi init complete.");
}

// --- Hàm MQTT ---
static void mqtt_event_handler(void *handler_args, esp_event_base_t base, int32_t event_id, void *event_data)
{
    esp_mqtt_event_id_t evt = (esp_mqtt_event_id_t)event_id;
    switch (evt)
    {
    case MQTT_EVENT_CONNECTED:
        ESP_LOGI(TAG, "MQTT CONNECTED. Task Publish se bat dau day du lieu.");
        xEventGroupSetBits(system_event_group, MQTT_CONNECTED_BIT);
        break;
    case MQTT_EVENT_DISCONNECTED:
        ESP_LOGW(TAG, "MQTT DISCONNECTED. Task Publish se bi dung.");
        xEventGroupClearBits(system_event_group, MQTT_CONNECTED_BIT);
        // Không cần gọi reconnect ở đây, WiFi event handler sẽ gọi nếu cần
        break;
    case MQTT_EVENT_ERROR:
        ESP_LOGE(TAG, "MQTT Error: %s", esp_err_to_name(((esp_mqtt_event_t *)event_data)->error_handle->esp_error_status));
        break;
    default:
        break;
    }
}

void mqtt_start()
{
    esp_mqtt_client_config_t cfg = {
        .broker.address.uri = MQTT_BROKER_URI,
    };
    mqtt_client = esp_mqtt_client_init(&cfg);
    if (mqtt_client == NULL)
    {
        ESP_LOGE(TAG, "Khong khoi tao duoc MQTT client!");
        return;
    }
    ESP_ERROR_CHECK(esp_mqtt_client_register_event(mqtt_client, ESP_EVENT_ANY_ID, mqtt_event_handler, NULL));
    ESP_ERROR_CHECK(esp_mqtt_client_start(mqtt_client));
    ESP_LOGI(TAG, "MQTT client started.");
}

// --- Task Đọc Dữ Liệu và Ghi vào Queue ---
void lux_read_task(void *pvParameters)
{
    while (1)
    {
        time_t now = get_current_time();
        float lux = bh1750_read_lux();

        // Kiểm tra lux hợp lệ (thường < 100000 lux)
        if (lux >= 0 && lux < 100000)
        {
            lux_data data;
            data.lux = lux;
            data.time = now;

            // Cố gắng gửi vào Queue ngay lập tức (timeout = 0)
            if (xQueueSend(lux_queue, &data, 0) != pdPASS)
            {
                // Dữ liệu bị mất nếu Queue đầy.
                ESP_LOGW(TAG, "Queue day, mat du lieu: Lux=%.2f", lux);
            }
            else
            {
                ESP_LOGI(TAG, "Lux: %.2f, Time: %lld (queued). Con %u slot trong.",
                         lux, (long long)now, (unsigned int)uxQueueSpacesAvailable(lux_queue));
            }
        }
        else if (lux != -1) // Nếu lux không hợp lệ nhưng không phải lỗi đọc I2C
        {
            ESP_LOGW(TAG, "Gia tri Lux khong hop le: %.2f", lux);
        }

        vTaskDelay(pdMS_TO_TICKS(READ_INTERVAL_MS));
    }
}

// --- Task Publish Dữ Liệu lên MQTT ---
void mqtt_publish_task(void *pvParameters)
{
    lux_data item;

    while (1)
    {
        // 1. Chờ MQTT có kết nối
        xEventGroupWaitBits(system_event_group,
                            MQTT_CONNECTED_BIT,
                            pdFALSE, pdTRUE,
                            portMAX_DELAY);

        // 2. Lấy dữ liệu từ queue (chờ vô hạn nếu queue trống)
        if (xQueueReceive(lux_queue, &item, portMAX_DELAY) == pdPASS)
        {
            char msg[128];
            // Format JSON payload
            snprintf(msg, sizeof(msg),
                     "{\"lux\": %.2f, \"time\": %lld}",
                     item.lux, (long long)item.time);

            // Publish với QoS=1 (ACK cần thiết)
            int msg_id = esp_mqtt_client_publish(
                mqtt_client,
                "esp32/luxbh1750",
                msg,
                0, // data len
                1, // QoS
                0  // Retain
            );

            if (msg_id < 0)
            {
                ESP_LOGW(TAG, "Publish failed, REQUEUING. MSG: %s", msg);
                // Cố gắng gửi lại vào đầu queue với timeout 100ms
                if (xQueueSendToFront(lux_queue, &item, pdMS_TO_TICKS(100)) != pdPASS)
                {
                    ESP_LOGE(TAG, "CRITICAL: Requeue FAILED. Data LOST! MSG: %s", msg);
                }
                // Chờ một chút trước khi thử lại để tránh flood
                vTaskDelay(pdMS_TO_TICKS(1000));
            }
            else
            {
                ESP_LOGI(TAG, "Published OK (ID: %d, Qlen: %u): %s",
                         msg_id, (unsigned int)uxQueueMessagesWaiting(lux_queue), msg);
            }
        }
    }
}

// --- app_main ---
void app_main(void)
{
    // Khởi tạo NVS
    ESP_ERROR_CHECK(nvs_flash_init());

    // Tạo Event Group và Queue
    system_event_group = xEventGroupCreate();
    lux_queue = xQueueCreate(QUEUE_LENGTH, QUEUE_ITEM_SIZE);
    if (lux_queue == NULL)
    {
        ESP_LOGE(TAG, "Khong tao duoc queue. Dung chuong trinh.");
        return;
    }

    // Khởi tạo I2C và Cảm biến
    ESP_ERROR_CHECK(i2c_master_init());
    bh1750_write_cmd(BH1750_POWER_ON);
    bh1750_write_cmd(BH1750_RESET);
    // Cài đặt chế độ đo
    bh1750_write_cmd(BH1750_CONT_H_RES_MODE);
    ESP_LOGI(TAG, "Khoi tao I2C va BH1750 thanh cong.");

    // Khởi tạo và kết nối WiFi
    wifi_init_sta();

    // Khởi tạo MQTT client
    mqtt_start();

    // Tạo các Task FreeRTOS
    xTaskCreatePinnedToCore(lux_read_task, "Lux_Read_Task", 4096, NULL, 5, NULL, 0);
    xTaskCreatePinnedToCore(mqtt_publish_task, "MQTT_Publish_Task", 8192, NULL, 6, NULL, 1);
}