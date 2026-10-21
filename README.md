# Bolblar Agent — Landing Page

A single static page: a download button for the agent and a demo video it made.

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

## Add your files

- The Download buttons link to the extension's Google Drive folder; change the two `href`s in `index.html` to move it.
- Videos made by the agent live in `assets/videos/` (`video-1.mp4` + `video-1.jpg` thumbnail, and so on).
  To add one, upload it there and copy a `<figure class="card">` block in `index.html`.
  Convert phone/`.MOV` recordings to H.264 MP4 so every browser can play them:

  ```sh
  ffmpeg -i input.MOV -c:v libx264 -crf 23 -pix_fmt yuv420p -c:a aac -movflags +faststart assets/videos/video-2.mp4
  ffmpeg -ss 5 -i assets/videos/video-2.mp4 -frames:v 1 assets/videos/video-2.jpg
  ```
