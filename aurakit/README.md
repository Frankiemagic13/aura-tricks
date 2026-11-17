# AuraKit (copy for aura-tricks)

AuraKit is the framework from the Aura developer (Sébastien Splitter Macak) for pages that run in
Aura Browser and the AuraClip App Clip. It needs **Aura 1.9 (App Store version 8) or later** for the
volume buttons, status bar, rotation lock and Liquid Glass buttons.

- Source: https://github.com/splitter77/aura_framework (commit `e4563a9`, 17 Nov 2026)
- Full reference: [API.md](API.md)
- Test page in this repo: [/aura8/](../aura8/)

To update this copy, get the new files from the source repo and replace the files in this folder.

## Use it in a page

```html
<script src="../aurakit/aurakit-mock.js"></script>   <!-- optional: desktop test with ?mock=host / ?mock=join -->
<script src="../aurakit/aurakit.js"></script>
```

All functions wait for Aura by themselves. You do not have to call `AuraKit.ready()` first.

## The new features (Aura version 8)

### Volume buttons as triggers

```js
const vol = await AuraKit.volumeButtons.watch(({ button }) => {
  if (button === 'up') { /* Volume + */ } else { /* Volume − */ }
});
// vol.stop();  — releases the buttons
AuraKit.volumeButtons.onUp(() => { /* only Volume + */ });
```

- The volume does not change and the iOS volume indicator does not show (`keepVolume: true`, the default).
- Works only while the page is on screen, not when the phone is locked.
- **App Clip:** Apple does not give App Clips the part that hides the indicator. On a spectator's
  App Clip the indicator can show, the volume can move, and at maximum or zero that button stops.
  In Aura Browser (your phone) it works fully.

### Close the App Clip

```js
AuraKit.quitAppClip().catch(e => console.log(e.message));
```

- Works only in the App Clip, from the main page (not an iframe).
- Bluetooth must be on and allowed on that phone. If not, the promise rejects and the App Clip stays open.
- `kill.js` already uses this: a past spectator's App Clip closes. If it cannot close, it goes to apple.com.

### Status bar

```js
await AuraKit.statusBar.hide();
await AuraKit.statusBar.show();                      // transparent: the page runs under the bar
await AuraKit.statusBar.show({ transparent: false });
```

Works in the App Clip and in Aura Browser full-screen mode only.

### Rotation lock

```js
await AuraKit.orientation.lock('portrait');   // or lock() = as it is now
await AuraKit.orientation.unlock();
```

### Liquid Glass buttons (experimental)

```html
<button data-aura-glass>Normal</button>
<button data-aura-glass="prominent" data-aura-tint="#0a84ff" data-aura-symbol="plus">Add</button>
```

Real Liquid Glass on iOS 26 or later, system blur on older iOS. The native button is always on top of the page.

## Important

Every new page load stops the volume buttons, unlocks the rotation and resets the status bar.
Start them again on each page.
