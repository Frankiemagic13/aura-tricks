# Gallery (native app)

A web page can only use the photos that you select. This app gives the gallery page
(`gallery/` in this repo) **full access** to your photo library. It shows the same page,
so all settings, the Inject word, the celebrity picture and the mosaic are the same.
The page loads from GitHub Pages, so a change to `gallery/index.html` shows in the app
without a new build.

The home screen name is **Photos**.

## Build and install (one time)

1. On your Mac, install Xcode and Homebrew. In Terminal:
   ```
   brew install xcodegen
   cd <folder with this README>
   xcodegen
   open Gallery.xcodeproj
   ```
2. In Xcode, select the **Gallery** project → target **Gallery** → **Signing & Capabilities**.
   Select **Automatically manage signing** and your **Team** (Personal Team).
   If the bundle identifier is not available, change `frankievalletech` to a different word.
3. Connect your iPhone, select it at the top of the Xcode window, and click **Run** (▶).
4. On the iPhone, open **Photos** (this app). When iOS asks for photo access, push
   **Allow Full Access**.

With a free Apple ID, the app stops working after 7 days. Then connect the iPhone and click **Run** again.

## Use

- The gallery shows all your photos and videos, oldest at the top, newest at the bottom (videos show their length).
- Settings: touch and hold the title "Library" for 1 second (same as the web page).
- Photos tab → shows "Full access: N photos and videos". If it shows "Limited access",
  push **iPhone Settings** → Photos → **Full Access**.
- New photos that you take while the app is open show at the bottom.
- The mosaic uses 400 photos from all parts of your library.
- The app needs the internet for the page, Inject and the celebrity look-up. Your photos are not sent online.

## Voice and volume buttons

- **Volume +** starts and stops listening (the phone buzzes). You can change this on the Voice tab.
- Say the listening phrase, for example "You said Taylor Swift". When the page finds a famous
  person, it stops listening (buzz), and the mosaic becomes that person.
- The first time, iOS asks for the **Microphone** and **Speech Recognition**. Push **Allow** for both.
- The listening phrase is on the Voice tab. Put `{name}` where the name goes.

## Read text (camera)

- On the Voice tab, set **Volume −** (or +) to **Read text on / off**.
- Push it (buzz), then point the camera at the word that the spectator wrote. Choose the back or
  front camera on the **Read text** tab. The screen continues to show the gallery.
- When the phone reads the same word 2 times, it buzzes and the mosaic becomes that word
  (or that person, if it is a famous name).
- The first time, iOS asks for the **Camera**. Push **Allow**. iOS shows a green dot while the camera is on.
