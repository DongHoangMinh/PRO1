import serial
import psycopg2
from datetime import datetime
ser = serial.Serial('COM8', 115200, timeout=1)
conn = psycopg2.connect(
    host="localhost",
    database="iotdb",
    user="postgres",
    password="minhtinh"
)
cur = conn.cursor()
conn.commit()
 
print("Đang đọc dữ liệu từ ESP32...\n")

# doc va ghi
try:
    while True:
       
        ser.flushInput()
        line = ser.readline().decode().strip()# byte to string
        if not line:
            continue

        try:
            lux = float(line)
        except ValueError:
            import re
            m = re.search(r"([0-9]+\.?[0-9]*)", line)
            if m:
                lux = float(m.group(1))# tra ve chuoi so khi co ca chu
            else:
                continue

        print(f" {datetime.now()} | Lux = {lux:.2f}")
        cur.execute("INSERT INTO bh1750_data (lux_value) VALUES (%s)", (lux,))
        conn.commit()

except KeyboardInterrupt:
    print("\n Dừng lại bởi người dùng.")

finally:
    ser.close()
    conn.close()
    cur.close()