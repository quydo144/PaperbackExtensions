# Kizias Extensions

Kho extension dành cho Paperback, được viết bằng TypeScript và sử dụng Paperback Toolchain 0.8.

> Dự án này chỉ cung cấp extension. Nội dung được tải trực tiếp từ các website nguồn tương ứng và không được lưu trữ trong repository.

## Cài đặt trên Paperback

1. Mở trang **Settings > External Sources** trong Paperback.
2. Chọn **Add Repository**.
3. Nhập URL repository đã được xuất bản bằng GitHub Pages.
4. Mở repository vừa thêm và cài extension mong muốn.

Với repository này, bản build của nhánh `main` được xuất bản tại:

[Mở Kizias Extensions trên GitHub Pages](https://quydo144.github.io/PaperbackExtensions/main/)

Nếu URL chưa hoạt động, hãy chạy workflow **Bundle and Publish Sources** và kiểm tra GitHub Pages đang được cấu hình để phục vụ từ nhánh `gh-pages`.

## Phát triển

### Yêu cầu

- Node.js 22
- npm
- Paperback

### Cài đặt

```bash
git clone https://github.com/quydo144/PaperbackExtensions.git
cd PaperbackExtensions
npm ci
```

### Chạy môi trường phát triển

```bash
npm run serve
```

Server mặc định chạy tại cổng `3002`. Để thử trên thiết bị thật, thêm URL do toolchain hiển thị vào Paperback. Máy tính và thiết bị cần truy cập được lẫn nhau trong cùng mạng.

### Kiểm tra extension

```bash
npm test
```

### Tạo bundle

```bash
npm run bundle
```

Các extension mới hoặc thay đổi mã nguồn được đặt trong thư mục `src`. Bundle tạo ra nằm trong thư mục `bundles`.

## Xuất bản bằng GitHub Actions

Repository có workflow chạy thủ công để build và xuất bản extension:

1. Push thay đổi lên GitHub.
2. Mở tab **Actions** của repository.
3. Chọn **Bundle and Publish Sources**.
4. Chọn **Run workflow**, chọn nhánh cần xuất bản rồi xác nhận.
5. Chờ job hoàn tất và kiểm tra nội dung trên nhánh `gh-pages`.

Mỗi nhánh được build vào một thư mục riêng mang tên nhánh đó. Workflow **Clean up published sources for deleted branch** dùng để xóa bundle của một nhánh không còn sử dụng; khi chạy, nhập chính xác tên nhánh vào `target_branch`.

## Cấu trúc chính

```text
.
├── .github/workflows/   # Workflow build, publish và dọn dẹp
├── bundles/             # Kết quả build
├── src/                 # Mã nguồn extension
├── package.json         # Scripts và dependencies
└── tsconfig.json        # Cấu hình TypeScript
```

## License

Dự án được phát hành theo giấy phép `GPL-3.0-or-later`.
