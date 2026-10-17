# Solitaire

Klondike solitaire for your phone, in portrait or landscape. Draw one or draw three, with moves, a timer and Windows-style scoring. Printed-style cards, a left or right stock for left- or right-handed play, and a red or blue back. Installs to the home screen and works offline. No server, no account.

## Host it

1. Create a public repository called `Solitaire` and upload every file in this folder (not the folder itself).
2. Go to **Settings → Pages**, choose **Deploy from a branch**, set the branch to **main** and the folder to **/ (root)**, then **Save**.
3. After a minute or two the game is at `https://<your-username>.github.io/Solitaire/`. The repository name is case-sensitive.

## Share it

Send the link. Everyone gets their own saved game and stats on their own device.

## Update

1. On GitHub choose **Add file → Upload files**, add the changed files (the same names replace the old ones), then **Commit changes**.
2. Every release bumps two markers together: `core.js?v=N` in `index.html` and `solitaire-vN` in `sw.js`. Change both, or phones may mix old and new files.
3. Wait about a minute, fully close the game and reopen it. If it still looks the same, close and reopen once more.

## Files

| File | What it does |
| --- | --- |
| `index.html` | The whole interface: markup, styles and the app script. |
| `core.js` | The rules, scoring, stats and table layout, with no screen code. |
| `sw.js` | Offline support and instant updates. |
| `manifest.webmanifest` | Lets the game install to the home screen. |
| `icon.svg`, `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png` | Icons. |

## How to play

- Tap a card to send it where it fits, or drag it to choose. Dragging a card in a column takes the cards on top of it too.
- Tap the stock to draw. When it runs out, tap it again to turn the waste back over.
- **Undo** is the arrow at the top, next to the eye. Tap **Solitaire** at the top left (or use Settings) for a new deal: replay this deal or play a friend's number. Each deal has a number.
- **Finish** (auto-complete) floats over the bottom of the table once every card is face up and the stock is empty, and plays out the rest for you.

## Good to know

- **Left or right hand:** in Settings, **Stock and waste** can sit on the Left (the default) or the Right. Right puts the stock under your right thumb and moves the foundations to the left. The seven columns stay where they are.
- **Card back:** Red or Blue in Settings. Night red and Amber dim the back to keep your eyes adjusted.
- **Rotating:** the game follows your phone's auto-rotate. If it stays upright, check that rotation isn't locked.
- **Saved game:** the game in progress, your theme and your stats are kept in this browser. On iPhone, Safari and the home-screen app keep separate copies.
- **Android notification:** on some phones, every launch of the installed app shows a Chrome notification saying "Tap to copy the URL for this app". That's Chrome's **Full screen site controls** category. Press and hold the notification and turn that category off. The game can't switch it off itself.
