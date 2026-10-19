# Slide — bộ công cụ làm bài thuyết trình

Repo này chứa skill, MCP và công cụ để Claude làm bài thuyết trình đẹp, nhiều hiệu ứng, rồi xuất ra PDF.
Người dùng nói tiếng Việt: trả lời bằng tiếng Việt, nội dung slide mặc định bằng tiếng Việt.

**Chỉ làm slide khi người dùng yêu cầu rõ ràng.** Cài skill, sửa cấu hình hay hỏi đáp không phải là yêu cầu làm slide.

## Skill đã cài (`.claude/skills/`)

| Skill | Nguồn | Dùng khi |
|---|---|---|
| `frontend-slides` | zarazhangrui/frontend-slides (MIT) | **Mặc định** cho mọi bài thuyết trình mới. 12 preset + 34 bold template, khung 1920×1080 cố định, hiệu ứng CSS, cho xem trước 3 phong cách. Chuyển đổi PPTX → HTML. |
| `html-ppt` | lewislulu/html-ppt-skill (MIT) | Cần nhiều theme dựng sẵn (36 theme, 15 deck mẫu, 36 layout), hiệu ứng canvas FX (pháo hoa, hạt, mạng nơ-ron…), hoặc **chế độ diễn giả có lời thoại** (template `presenter-mode-reveal`, phím S). |
| `guizang-ppt-skill` | op7418/guizang-ppt-skill (**AGPL-3.0**) | Phong cách tạp chí (serif + nền WebGL) hoặc Swiss (lưới, IKB/vàng chanh). Có chế độ diễn giả, đồng bộ màn hình khán giả. |
| `frontend-design` | anthropics/skills (Apache-2.0) | Nguyên tắc thẩm mỹ: font, màu, bố cục có chủ đích, tránh “AI slop”. Áp dụng cùng mọi skill slide. |
| `theme-factory` | anthropics/skills (Apache-2.0) | Áp 1 trong 10 theme màu/font phối sẵn, hoặc tạo theme mới. |
| `canvas-design` | anthropics/skills (Apache-2.0) | Ảnh tĩnh nghệ thuật (poster, ảnh bìa, hình minh hoạ) để đặt vào slide. |
| `find-skills` | vercel-labs/skills (MIT) | Tìm và cài thêm skill từ hệ sinh thái skills.sh. |

Skill `pdf` và `pptx` của Anthropic có sẵn trong Claude (`anthropic-skills:pdf`, `anthropic-skills:pptx`) — dùng khi cần đọc/sửa PDF hoặc người dùng đòi file `.pptx`.

Chọn skill:
- Không nói gì thêm → `frontend-slides`.
- Muốn chọn nhanh trong nhiều theme, cần lời thoại cho người thuyết trình → `html-ppt`.
- Nói “tạp chí”, “magazine”, “Swiss”, “editorial” → `guizang-ppt-skill`.
- Cần file PowerPoint chỉnh sửa được → `anthropic-skills:pptx`.

## Skill làm video

| Bộ skill | Nguồn | Dùng khi |
|---|---|---|
| `hyperframes` (+ `hyperframes-core`, `-animation`, `-keyframes`, `-creative`, `-cli`, `media-use`, `faceless-explainer`, `motion-graphics`, `general-video`) | heygen-com/hyperframes (Apache-2.0) | **Mặc định cho video.** Video dựng bằng HTML + GSAP, render ra MP4 — cùng kiểu với slide HTML của repo nên tái dùng được font, màu, hiệu ứng. Luôn vào qua skill `hyperframes` (nó định tuyến tới workflow con). |
| `remotion-*` (12 skill, router là `remotion-best-practices`) | remotion-dev/skills | Video dựng bằng React. Dùng khi người dùng muốn Remotion hoặc dự án đã có Remotion. |

Ghi chú:
- Video giải thích một chủ đề (vd. phần “Ứng dụng” của bài) → `faceless-explainer`; đoạn motion ngắn dưới 10 giây → `motion-graphics`.
- Lần đầu render HyperFrames cần `npx hyperframes browser ensure` (tải Chrome Headless Shell, đã chạy được ở cloud). `npx hyperframes doctor` để kiểm tra.
- Lồng tiếng (TTS) và nhạc nền cục bộ chưa cài; hỏi người dùng trước khi cài thêm.
- Video dự án đặt ở `videos/<tên>/`. Muốn đưa video vào deck thì xuất MP4 rồi nhúng `<video>` vào slide; trong PDF chỉ còn khung hình tĩnh, nên chèn ảnh các cảnh ngay sau slide video: `ffmpeg -ss <giây> -i video.mp4 -frames:v 1 canh.jpg` rồi `node tools/insert-images.mjs deck.pdf <số trang slide video> out.pdf canh*.jpg`.
- HyperFrames ở cloud: CDN jsdelivr bị chặn → chép `gsap.min.js` từ npm (`npm pack gsap`) vào `assets/vendor/`; font phải có `@font-face` trỏ file cục bộ ngay trong `index.html`; di chuyển phần tử bằng `x`/`y` (transform), không dùng `left`/`top` (lint báo lỗi vì giật hình). Chạy `npx hyperframes check` đến khi đạt, xem `snapshot --at` trước khi `render` (~10 khung/giây ở cloud).
- Ví dụ hoàn chỉnh: `decks/bai-8-he-tieu-hoa/` (deck) và `videos/tieu-hoa-3d/` (video 3D nhúng ở slide 12 của deck).
- **Video 3D**: dùng Three.js qua adapter `three` của HyperFrames (xem `hyperframes-animation/adapters/three.md`). Chép `three.module.js` + `three.core.js` và các addon cần (postprocessing bloom, RoomEnvironment) từ `npm pack three` vào `assets/vendor/three/`, khai báo importmap trỏ file cục bộ. Cảnh phải là hàm thuần của thời gian `renderAt(t)` gọi từ sự kiện `hf-seek`; hình dạng cơ quan dựng thủ tục (tube quét theo đường cong, bán kính thay đổi theo thời gian để tạo nhu động). Ở cloud render bằng SwiftShader ~2 khung/giây với `-w 3`; xem `snapshot --at` trước để chỉnh ánh sáng (bloom + env map dễ làm màu bạc trắng).

## Quy tắc khi làm slide

- Mỗi deck đặt ở `decks/<tên-deck>/index.html`, ảnh/video kèm theo trong cùng thư mục.
- Làm theo đúng quy trình của skill đã chọn (hỏi mục đích, độ dài, mật độ chữ; cho xem trước phong cách trước khi dựng cả deck).
- **Font phải có bộ chữ tiếng Việt**, nếu không dấu sẽ vỡ. Đã kiểm tra trên Google Fonts:
  - Có tiếng Việt: Be Vietnam Pro, Bricolage Grotesque, Fraunces, Space Grotesk, Unbounded, Big Shoulders Display, Playfair Display, Manrope, Lexend, Montserrat, Plus Jakarta Sans, Noto Serif Display, Cormorant Garamond, JetBrains Mono, Anton, Dela Gothic One, Epilogue, Archivo, Literata, Saira Condensed.
  - **Không** có tiếng Việt (tránh cho chữ tiếng Việt): Archivo Black, Syne, Sora, Bodoni Moda, Instrument Serif. Một số preset/template trong skill dùng các font này — thay bằng font tương đương ở danh sách trên.
  - Font từ Fontshare (Clash Display, Satoshi…) thường không có tiếng Việt và còn bị chặn mạng ở cloud — dùng Google Fonts.
- Hiệu ứng nên viết bằng CSS transition/animation hoặc Web Animations API: công cụ xuất PDF tua nhanh được các hiệu ứng này. Hiệu ứng chạy bằng `requestAnimationFrame`/`setInterval` (ví dụ bộ đếm số) phải đạt trạng thái cuối trong khoảng `--wait`.
- Hiệu ứng lặp vô hạn bị chụp ở thời điểm ngẫu nhiên. Nếu trạng thái chụp quan trọng, đặt `animation-play-state: paused` với `animation-delay` âm để cố định khung hình đẹp nhất.
- Sau khi dựng, luôn xuất PDF rồi xem ảnh từng trang (`pdftoppm -r 50 -png deck.pdf /tmp/p`) để kiểm tra tràn chữ, chồng lấn, lỗi font.
- Chữ gradient (`background-clip: text`) hoặc dòng có `overflow: hidden` + `line-height` thấp sẽ **cắt mất dấu tiếng Việt** (Ở → Ơ, Ộ → O). Thêm padding trên/dưới ~0.16em cho phần tử đó.
- Chữ trắng trên nền màu cần tương phản ≥ 3:1 (chữ lớn). Bảng màu đã kiểm: xanh lá `#3a9a4a`, xanh ngọc `#178a79`, đỏ san hô `#d63f4d`, cam `#d8652a`, tím `#7b5ea7`, xanh dương `#2f6fde`; vàng `#efb02a` phải dùng chữ tối.
- Khi người dùng yêu cầu giữ nguyên nội dung: chép đúng từng chữ (chỉ sửa lỗi chính tả và báo lại), rồi đối chiếu tự động từng dòng của tài liệu gốc với chữ trong HTML trước khi giao.

## Xuất PDF có hiệu ứng (`tools/export-pdf.mjs`)

Công cụ của repo này: chụp từng slide bằng Chromium ở 1920×1080, ghép thành PDF 16:9 có **hiệu ứng chuyển trang PDF thật** (`/Trans`). Hoạt động với deck của cả ba skill slide.
Script xuất PDF riêng của các skill làm mất hiệu ứng và chỉ chạy trên macOS hoặc phải tải Chromium — dùng công cụ này thay thế.

```bash
npm ci --prefix tools        # lần đầu (cloud session tự chạy qua hook)
node tools/export-pdf.mjs decks/<tên>/index.html -t mix
```

| Tuỳ chọn | Ý nghĩa |
|---|---|
| `-t <hiệu ứng>` | `fade` (mặc định), `dissolve`, `push`, `cover`, `uncover`, `wipe`, `split`, `blinds`, `box`, `glitter`, `fly`, `zoom`, `replace`, `none`, `mix` (luân phiên) |
| `-d <giây>` | Thời lượng chuyển trang (mặc định 0.7) |
| `--steps` | Mỗi bước build (fragment) một trang, như Keynote |
| `--animate[=N]` | Lấy mẫu N khung hình hiệu ứng vào mỗi slide, tự chạy khi trình chiếu (file nặng hơn nhiều; N=10–12 cho mượt) |
| `--scale 2` | Xuất 4K |
| `--png` | Ảnh không nén (nét hơn, nặng hơn) |
| `--selector <css>` | Khi slide không dùng class `.slide` |
| `--no-fullscreen` | Không yêu cầu mở toàn màn hình (khi gửi để đọc/in) |
| `--window <giây>` | Với `--animate`: chỉ lấy mẫu N khung trong vài giây đầu (vd. `--animate=12 --window 2` → ~6 khung/giây, đủ mượt cho hiệu ứng chuyển trang) |

Ghi đè từng slide bằng thuộc tính HTML: `<section class="slide" data-pdf-transition="zoom" data-pdf-duration="1.2">`.
Với `--animate`, hiệu ứng chuyển trang HTML của deck được ghi thành khung hình nên PDF không thêm `/Trans` (trừ khi truyền `-t`).

## Hiệu ứng chuyển trang trong deck HTML

Deck mẫu `decks/bai-8-he-tieu-hoa/` có bộ điều khiển chuyển trang (Web Animations) với 17 hiệu ứng, khai báo từng slide bằng `data-transition="…"` (hiệu ứng để *đi tới* slide đó; lùi lại thì chạy ngược):
`fade` · `push` · `slideup` · `cube` (khối lập phương xoay 3D) · `flip` (lật thẻ) · `zoom` · `blur` · `swirl` (xoáy) · `door` (cửa mở 3D) · `glitch` · `iris` (mống mắt, tâm đặt bằng `data-origin="x y"`) · `wipe` · `diagonal` · `blinds` (sáo dọc) · `shutter` (sáo ngang) · `split` (rèm mở giữa) · `cell` (tế bào nuốt màn hình, viền màng tế bào).
Hiệu ứng mặt nạ dùng `mask-image` bù trừ nhau qua biến `--p` nên hai slide không chồng chữ. Phím **T** khi trình chiếu: thử lần lượt mọi hiệu ứng. Làm deck mới thì chép phần `TRANSITION ENGINE` trong script của deck này.

Hiệu ứng chỉ hiện khi trình chiếu toàn màn hình trong **Adobe Acrobat Reader, Foxit, Okular** (và pdfpc, Impressive). macOS Preview và trình xem PDF của trình duyệt chỉ hiện trang tĩnh — nói rõ điều này với người dùng.

## MCP tìm video mẫu (`.mcp.json`)

- **`yt-dlp`** (`@kevinwatt/yt-dlp-mcp`, không cần API key): tìm video YouTube (`ytdlp_search_videos`), đọc metadata, phụ đề/transcript, bình luận, tải video/audio. Dùng để tìm video mẫu về thiết kế slide, hiệu ứng chuyển cảnh, bài nói tham khảo. Cần `yt-dlp` trên máy (`pip install yt-dlp`). File tải về lưu ở `media/downloads/` (không commit).
- **`pexels`** (`mcp-pexels`): tìm và tải video/ảnh stock miễn phí bản quyền để làm nền slide. Cần `PEXELS_API_KEY` (đăng ký miễn phí tại pexels.com/api) đặt trong biến môi trường; thiếu key thì server không khởi động.

Video nhúng vào deck chỉ chạy trong HTML; trong PDF nó là ảnh tĩnh của khung hình đang hiển thị.

## Tìm và cập nhật skill

- `npx skills find <từ khoá>` — tìm skill (xem thêm skill `find-skills`). Ưu tiên skill có trên 1K lượt cài, từ nguồn uy tín, repo nhiều sao.
- `npx skills add <owner/repo> --skill <tên> -a claude-code --copy -y` — cài vào `.claude/skills/` và ghi vào `skills-lock.json`.
- `npx skills update -p -y` — cập nhật các skill trong repo.
- Đọc `SKILL.md` của skill mới trước khi dùng: skill chạy với toàn quyền của agent.

## Môi trường cloud

Mạng ở cloud session bị giới hạn: Google Fonts, npm và GitHub tải được; `cdn.jsdelivr.net`, `unpkg.com`, `api.fontshare.com`, `youtube.com`, `tiktok.com`, `docs.google.com`, `api.pexels.com` bị chặn trừ khi người dùng thêm vào Allowed domains của environment. Không đọc được link Google Docs thì nhờ người dùng dán nội dung hoặc tải file lên. Vì vậy trong cloud: nhúng JS trực tiếp vào HTML thay vì tải từ CDN, và MCP `yt-dlp`/`pexels` chỉ chạy được khi đã mở các domain trên.
Chromium có sẵn ở `/opt/pw-browsers` — không chạy `playwright install`.
