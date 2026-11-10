# Peek Island

Shows the calculator peeks in the Dynamic Island and on the lock screen of your iPhone (Live Activity).

The calculator (`c/index.html`) sends each peek to the ntfy.sh channel `fvt-c-k27x9m4q8w`.
This app listens to the same channel and updates the Live Activity.

## Build and install (one time)

1. On your Mac, install Xcode (App Store) and Homebrew (https://brew.sh).
2. In Terminal:
   ```
   brew install xcodegen
   cd <folder with this README>
   xcodegen
   open PeekIsland.xcodeproj
   ```
3. In Xcode, select the **PeekIsland** project (blue icon at the top left) → target **PeekIsland** → **Signing & Capabilities**.
   - Select **Automatically manage signing**.
   - **Team:** select your Apple ID ("Personal Team"). If it is not there: Xcode → Settings → Accounts → **+** → Apple ID.
4. Do step 3 again for the target **PeekWidget**. Use the same team.
5. If Xcode says that the bundle identifier is not available, change `frankievalletech` in both bundle identifiers to a different word (for example your name). The widget ID must start with the app ID.
6. Connect your iPhone with a cable. Select it at the top of the Xcode window. Click **Run** (▶).
7. On the iPhone:
   - Settings → Privacy & Security → **Developer Mode** → On (the iPhone restarts).
   - Settings → General → VPN & Device Management → your Apple ID → **Trust**.
8. Open **Peek Island** and tap **Start**. Then tap **Send test peek**. The Dynamic Island and the lock screen must show `+8`.

With a free Apple ID, the app stops working after 7 days. Then connect the iPhone and click **Run** again.

## Use

- Open Peek Island, tap **Start**, and lock the phone or go to another app.
- **Keep running in background** (on by default) plays silence so that iOS does not stop the app. Your music still plays.
- **Open the Island on each peek** expands the Dynamic Island for a moment on each new peek (it can make a sound).

## PeekSmith

Peek Island sends each peek to your PeekSmith over Bluetooth. You do not need Bluefy or the link page.

1. Turn the PeekSmith on.
2. In Peek Island, tap **Connect PeekSmith**. Allow Bluetooth when iOS asks.
3. Tap **Send test to PeekSmith**. You must see "Test 123". If not, set **Text prefix** to `#`.

- It also works when the PeekSmith app is connected: iOS shares the Bluetooth connection.
- The app remembers the PeekSmith and reconnects automatically after **Start**.
- **Short peek only:** sends `+8`, `+` or the result, not the full sum.
- **Vibrate on each peek:** the PeekSmith vibrates on each new peek.

## What the Dynamic Island shows

| Calculator sends | Compact Island (right side) |
|---|---|
| `12 + 34 + 56 (+)` | `+` |
| `12 + 34 + 56 (-)` | `−` |
| `12 + 34 + 56 + 8 taps` | `+8` |
| `12 + 34 + 56 + 11090449 = 11,090,551` | `11,090,551` |
| `12 + 34` | `34` |

Long-press the Dynamic Island, or look at the lock screen, to see the full text.
