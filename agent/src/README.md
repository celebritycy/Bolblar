# Bolblar Agent 1.0

Create every visual for your video in Google Flow in one batch. Your hero stays the same, your style stays the same, and every image is saved with its timestamp so it drops straight onto your voiceover in the Bolblar editor.

## Subscription
Bolblar Agent needs an active monthly subscription. On first open, tap Subscribe and pay on Paystack: the agent unlocks by itself and shows your access code. On another device, paste the same code. One code works on 2 devices. Settings shows your code, Manage subscription (update card or cancel), and Sign out of this device.

## Which devices

| Device | Browser | How it runs |
|---|---|---|
| Laptop or desktop (Windows, Mac, Linux, Chromebook) | Chrome or Edge | Side panel. Every feature. |
| Android | Mises or Edge Canary | Floating panel. Tap the yellow B button on Flow. |
| iPhone or iPad | Orion (or Mises) | Floating panel. Save images through the share sheet. |

Not supported: the normal Chrome app on phones, Safari and Firefox. They don't run Chrome extensions.

## Install on a laptop

1. Unzip this folder somewhere you will keep it.
2. Open `chrome://extensions` (or `edge://extensions`) and switch on **Developer mode**.
3. Click **Load unpacked** and choose the unzipped `Bolblar-Agent` folder.
4. Pin Bolblar Agent, open Google Flow (flow.google.com), open a project, then click the icon.

## Install on Android

1. Install **Mises** from the Play Store.
2. Download the Bolblar ZIP from Telegram. Telegram saves it in the **Telegram Documents** folder.
3. In Mises: menu (⋮) → **Extensions** → switch on **Developer mode** → tap **+ (from .zip/.crx/.user.js)** → choose the ZIP.
4. Menu (⋮) → tick **Desktop site**, so Flow shows its full layout.
5. Open Google Flow and open a project. Tap the yellow **B** button on the right, or tap Bolblar Agent at the bottom of the browser menu.

## Install on iPhone or iPad (beta)

1. Install **Orion Browser by Kagi** from the App Store.
2. In Orion: menu (•••) → Settings → turn on Chrome extensions.
3. Save the Bolblar ZIP to **On My iPhone** in the Files app. Do not leave it in iCloud Drive, because Orion may fail to read it there.
4. In Orion: menu (•••) → Extensions → **+** → install from file → choose the ZIP. If the ZIP is refused, unzip it in Files and choose the `manifest.json` file inside the folder.
5. Open Google Flow and open a project. Tap the yellow **B** button on the right.

iPhone install from a file is still beta in Orion. If it fails on your phone, use a laptop or Android for now.

## Before your first batch on any device

Open Settings (⚙) and tap **Run setup check**. Every line should be green. Each red line tells you exactly what to fix.

On phones, keep Flow open and on screen while a batch runs. Bolblar keeps your screen awake where the browser allows it. If the setup check says it can't, set Auto Lock to Never during the batch.

## Step by step (default)
The agent asks one thing per screen:
Finished, or want to start over? Tap **+ New** at the top (or **Start a new video** at the end of a batch). It clears the script, shot list, characters, voiceover and images in the agent, keeps your style and settings, and names the next folder video_2, video_3 and so on. Files you already saved stay where they are.

1. Your script: paste it, choose exactly how many seconds each image stays on screen (1s to 12s, 6s by default) and see how many images it will make, tap Copy prompt, run it in ChatGPT, Gemini or Claude, paste the reply back.
2. Pick a style, or make your own: open "My own style", add up to 10 example images, copy the style prompt into ChatGPT or Gemini with the same images, and paste the reply back. Your style is saved for future videos. The example images are never sent to Flow, so Flow can't copy them into your scenes; the style travels as the written description.
3. Main character: someone from your story, a ready made one, your own, or none. Make a character sheet in Flow and tap the best one, or upload your own picture of the character, to lock it in.
4. Voiceover and motion (optional): add your voiceover so slides match it, and choose how much moves. Made the voiceover in several parts? Select all the parts together, or add them one by one with "Add the next part". They are joined in name order (part 1, part 2, part 3).
5. Create: the full run page. Start, Pause, Skip, Stop, Retry failed, every slide with its image, and Animate when the images are done.
Files: tap the folder icon at the top (it shows how many images are ready). On a computer, tap "Choose a folder on this computer" to save every image straight into any folder you pick (asked once per visit to allow it). On Android, "Save to device" sends all images to Gallery, Photos or Drive. On iPhone, "Save images to Photos or Files". Also here: saving options, Download all, ZIP, timeline, status sheet and Copy all prompts.
Settings (⚙): setup check, characters and places (fix a description), AI key, timing, troubleshooting.

## Your workflow

1. **Script tab, box 1:** paste your script and tap **Copy prompt for your AI**.
2. Paste it into ChatGPT, Gemini or Claude and copy the **whole** reply.
3. **Box 2:** paste the reply. It loads by itself: every slide, the characters and places with fixed looks, and which scenes to animate.
4. **Timing:** tap **Sync to my voiceover** and choose your voiceover audio (MP3, WAV, M4A). Bolblar listens for the pauses and gives every slide the real second its sentence starts. SRT captions work too.
5. **Style tab:** pick a style and how much to animate (Light 20% by default).
6. **Run tab:** Start batch. Bolblar makes reference sheets for the main characters and places first, then every slide.
7. **Files tab:** Download everything as ZIP, in slide order.

Optional: Settings → AI helper lets Bolblar ask Gemini itself with your own free key, so step 2 disappears.

## Story bible: everything stays the same
The prompt you copy in step 1 asks your AI for a story bible: the ERA (years, region, and what must match that time), every recurring CHARACTER (people and animals, with height and family links), PLACE (inside and outside), and THING (cars, objects, evidence, uniforms). The shot list says which characters, place and things are in each slide, which moment it belongs to, and its time of day, weather and light. The agent locks all of it into every slide, so the car, the backpack, the era and the lighting stay the same. Fix or add anything in Settings, under Characters, places and things.

On a computer, Chrome shows a bar saying "Bolblar Agent started debugging this browser". That is normal: it is how the agent clicks Create for you. Do not press Cancel while a batch runs.

## Consistency and blocked slides
- Reference pictures of your characters and places stay attached in Flow's prompt box. Before each slide Bolblar checks them and swaps them only when a slide needs different people or places.
- If Flow blocks a slide for its content, the slide is marked failed and the batch keeps going. Change its prompt (tap the slide) and press Redo, or press Retry failed at the end.
- On a phone, the batch pauses when Flow goes to the background and continues when you come back.

## Animating slides
1. Make all the still images first with Flow on Image.
2. In Flow, switch to Video, then Frames, and pick the length (4s to 10s) and quality.
3. On the Run tab, tap Animate. Each chosen slide's own image becomes the start frame, so the video matches the still.
Videos are saved with the same name as the slide image (Slide_04_00m15s-00m20s.mp4), so they drop straight into your timeline. If a video fails, the still image stays in its place.

## Why files are always named correctly

Bolblar makes one image at a time. It never sends the next prompt until the current image has arrived, so every image lands on the right slide by itself. Flow must be set to x1 (one image per prompt). If an image takes longer than 3 minutes, Bolblar keeps waiting and tells you; tap **Skip** to move on. If a skipped image still arrives later, Bolblar puts it back on its own slide; if one ever looks wrong, tap the slide and press Redo.

## Safety

Bolblar pauses on its own if Google shows an unusual activity warning, a credits or limit message, or a confirmation it needs from you. It never clicks agreements for you. Keep "Seconds between prompts" sensible and use your own account responsibly.

## Pace (protects your account)
One prompt at a time: the agent waits for each image before sending the next. At least 12 seconds between prompts, and a 2 minute rest after every 25 images. Change these in Settings, under Batch.

## Settings

Bolblar follows Google Flow. Whatever you set in Flow (the model, the size, and x1 to x4 images per prompt) is what Bolblar uses. Change them in Flow, not in Bolblar.

In Bolblar's Settings you only have:

| Setting | What it does |
|---|---|
| Run setup check | Green or red for every requirement, with the fix for each red line. |
| Seconds between prompts | The pause before the next prompt. |
| Stop after | Stops after this many slides, so you never use all your credits at once. 0 means run them all. |
| Sound | Plays a sound when the batch finishes. |
| Troubleshooting | Only if Google changes Flow's layout: lock the prompt box and create button by tapping them. |

On a laptop Bolblar clicks Create with real clicks, so Chrome shows a "started debugging this browser" bar during a batch. That's expected. Leave it open.
