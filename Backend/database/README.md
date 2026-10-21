# Cấu trúc BCNF với năm bảng

BCNF yêu cầu vế trái của mọi phụ thuộc hàm không tầm thường là một siêu khóa.
Phân tích dưới đây dựa trên quy tắc nghiệp vụ, không suy luận phụ thuộc chỉ vì
các dòng dữ liệu mẫu có cùng giá trị.

| Bảng | Thuộc tính | Khóa và phụ thuộc chính |
| --- | --- | --- |
| users | id, username, password_hash, full_name, email, role | id → các thuộc tính còn lại; username → các thuộc tính còn lại |
| devices | id, device_name, led_state, connection_status, last_seen | id → các thuộc tính còn lại |
| sensors | id, device_id, sensor_type, sensor_name | id → các thuộc tính còn lại; (device_id, sensor_type) → id, sensor_name |
| data_sensor | id, sensor_id, value, timestamp | id → các thuộc tính còn lại |
| action_history | id, user_id, device_id, action, status, message, timestamp, completed_at | id → các thuộc tính còn lại |

- `users.username` là khóa ứng viên. Email không rỗng là duy nhất, nhưng email có thể NULL;
  không coi email là khóa ứng viên bắt buộc của toàn bảng. Họ tên không quyết định username/email.
- Tên thiết bị và tên cảm biến không bắt buộc duy nhất. `sensor_name` là tên của từng
  cảm biến cụ thể; hai cảm biến cùng loại trên hai thiết bị có thể được đặt tên khác nhau.
- Mỗi thiết bị có tối đa một cảm biến mỗi loại, được bảo đảm bởi UNIQUE(device_id, sensor_type).
- Đơn vị cố định phụ thuộc loại cảm biến. Bỏ `sensors.unit` để loại bỏ phụ thuộc
  `sensor_type → unit` với vế trái chưa phải siêu khóa; backend cung cấp đơn vị cho API.
- `data_sensor` chỉ lưu `sensor_id`, không lặp `device_id` và `sensor_type` đã có trong sensors.
  Không đặt UNIQUE(sensor_id, timestamp), vì hệ thống không cấm nhiều phép đo cùng mili giây.
- Trạng thái kết nối không được suy ra chỉ bằng last_seen: thiết bị có thể gửi OFFLINE trực tiếp.
  Trạng thái LED hiện tại có thể được ESP32 báo qua bản tin trạng thái, không chỉ từ lệnh điều khiển.
- Trạng thái xử lý lệnh không quyết định thời điểm hoàn tất hay thông báo cụ thể.

Theo các phụ thuộc trên, mọi vế trái đều là khóa hoặc siêu khóa, nên năm bảng đạt BCNF.
Tham khảo định nghĩa: https://bohr.wlu.ca/cp363/notes/theory/09_normalization.php

## Tương thích ứng dụng

API vẫn trả sensor_name, sensor_type, unit, status, value và timestamp cho giao diện.
`status` của dữ liệu đo tiếp tục trả `Normal` theo hành vi hiện tại; hệ thống chưa có đánh giá ngưỡng.
MQTT payload, ID ba LED, xác thực và các endpoint không đổi.

Firmware mới quy đổi tuyến tính ADC 12-bit (0–4095) sang thang ánh sáng 0–1000 lux
ước lượng, làm tròn số nguyên. Mạch LDR hiện tại cho ADC giảm khi sáng hơn, nên
dùng công thức round((4095 − ADC) × 1000 / 4095) để sáng hơn cho giá trị lớn hơn. Backend chỉ nhận light trong [0, 1000]; trục ánh sáng
trên Dashboard cố định 0–1000. LDR chưa được hiệu chuẩn với thiết bị đo độ rọi, nên
đây là thang ước lượng, không bảo đảm độ rọi thực tế. Các bản ghi lịch sử từ firmware
cũ được giữ nguyên; chúng có thể chứa ADC thô lớn hơn 1000. Không quy đổi lịch sử
tự động vì bản tin cũ không có thông tin phiên bản thang đo.

## Kiểu dữ liệu linh hoạt

Sáu cột trước đây dùng ENUM hiện dùng VARCHAR: users.role (20), devices.led_state (10),
devices.connection_status (20), sensors.sensor_type (50), action_history.action (10),
action_history.status (20). Giữ nguyên NOT NULL, default, khóa và index.
Các trường vai trò/trạng thái có CHECK để giữ tập giá trị nghiệp vụ hiện tại.
sensor_type không có CHECK giới hạn loại, nên có thể thêm WindSpeed bằng INSERT.
Backend và firmware vẫn xử lý ba loại cảm biến hiện có; đổi kiểu dữ liệu không tự
bổ sung phần đọc/gửi/hiển thị loại mới.

## Chuyển đổi

Dùng `npm run db:migrate` khi backend đã dừng và MySQL đang chạy. Script lưu bản sao
ngoài CSDL trước khi sửa, nhận diện các phiên bản schema cũ và kiểm tra số bản ghi sau chuyển đổi.
Migration 003 đổi ENUM sang VARCHAR. Nếu chỉ thực hiện bước này trên schema BCNF,
script đối chiếu toàn bộ giá trị từng dòng trong cả năm bảng với bản sao lưu.
Migration 002 tạo bổ sung các danh mục cảm biến còn thiếu từ dữ liệu đo cũ, liên kết qua
sensor_id rồi bỏ các thuộc tính dư. Nếu có đơn vị tùy chỉnh khác cấu hình cố định,
migration dừng trước mọi ALTER để tránh âm thầm đổi nghĩa dữ liệu. Trường hợp lỗi mã hóa
Windows cũ của ký hiệu độ C (byte UTF-8 `E294ACE2969143`) được nhận diện riêng và API
trả lại `°C`; giá trị gốc vẫn có trong bản sao lưu.

Bản sao JSON gồm câu lệnh CREATE TABLE và các dòng dữ liệu từng bảng; BIGINT/DECIMAL
và DATETIME được lưu dạng chuỗi khi cần để giữ độ chính xác. Có thể dựng lại schema cũ
trong một database riêng, sau đó nạp rows theo thứ tự users, devices, sensors,
data_sensor, action_history. Không chạy seed trước khi đối chiếu dữ liệu đã phục hồi.
