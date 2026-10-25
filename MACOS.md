# AppSEND for macOS

Local port of Murk1ins-ka/AppSEND, based on commit cbea2dfb.

## Build

Install Node.js and npm, then run:

```sh
cd desktop
npm ci
npm test
npm run dist:mac
```

The build produces separate DMGs for Apple Silicon (arm64) and Intel (x64).
The app is ad-hoc signed for local testing. It has no Developer ID signature or
Apple notarization. For distribution, replace `build.mac.identity` with your
Developer ID configuration and configure notarization.

## macOS behavior

- Native system font and standard macOS window frame.
- Native application, File, Edit and Window menus.
- Cmd+O chooses a file; Cmd+Shift+V stages clipboard text; Cmd+Return sends it.
- Closing the window keeps receiving active; the Dock icon reopens the window.
  Cmd+Q exits and closes network services.
- Edge interaction uses the display work area, below the menu bar and outside
  the Dock. Received files go into Downloads/AppSEND.
- Discovery announces macOS. The existing Android client accepts this platform
  without a wire protocol change.
- Allow Local Network access when macOS requests it.

## Validation

21 Node tests passed, including discovery platform labels, macOS/Windows window
lifecycle, real encrypted transfers, corruption and replay rejection.
The packaged Intel app was launched on macOS. Its renderer discovered a local
test peer, sent encrypted UTF-8 text and received a 1 MiB file without byte loss.
A Xiaomi 13T on Android 16 / HyperOS 3 discovered the Mac over the local network.
Xiaomi Gallery 4.3.1.19-global shared a generated 33,811-byte PNG to Android
AppSEND, which sent it to this Mac app. SHA-256 matched the source:

```
36d09d5e869789a0c4f73c8736fbb191779833a8bac1ed7f4ff162f56f08301f
```

Apple Silicon was built and its bundle signature checked, but it was not run on
Apple Silicon hardware. Camera gesture recognition and a gesture over another
Android app were not validated by these transfer checks.
