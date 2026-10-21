# Bolblar Agent — Landing Page

A single static page: a download button for the agent and a demo video it made.

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000
```

## Add your files

- The Download buttons link to the extension's Google Drive folder; change the two `href`s in `index.html` to move it.
- `assets/demo.mp4` — a video made by the agent (16:9, H.264 MP4 plays everywhere).
- `assets/demo-poster.jpg` — optional thumbnail shown before the video plays.

Until `demo.mp4` exists, the player shows "Demo video coming soon".
