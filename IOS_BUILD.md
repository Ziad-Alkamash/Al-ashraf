# iOS build

The iOS target is a Capacitor app that packages the existing local `www/` assets. It can be built on GitHub's macOS runner; a Mac is not needed on the developer's Windows machine.

## Create a device build

1. Push this branch to the repository's `main` branch. Changes to the iOS target, Capacitor dependencies, app web assets, or app version automatically start the iOS cloud build.
2. You can also start a build manually from **Actions → iOS unsigned device build → Run workflow**.
3. Download the `AlAshraf-iOS-unsigned` artifact from the completed run.

The workflow compiles an iPhone device build without an Apple distribution certificate. It does not publish the app or need signing secrets. A later sideloading step must sign the IPA with the installer's Apple Account; free-account signing expires periodically. We can choose that installation process after reviewing the build.

## Native iOS notes

- Bundle identifier: `com.ashraf.mushaf`.
- Minimum deployment target: iOS 15.
- Capacitor 8 plugins with iOS implementations are included through Swift Package Manager.
- App icon and launch screen use the existing olive and calligraphy brand assets.
- Speech search, location prompts, status bar integration, local notifications, sharing, and audio playback use the iOS platform APIs/plugins.
- Several extra native features currently exist only in the Android project: home-screen widgets, Android media-notification controls, exact full-length adhan playback after the app is closed, and self-renewing native adhkar/salawat alarms. The main reading, offline bundled Quran pages, browsing, and in-app audio UI are packaged for iOS, but those Android-only system integrations need separate iOS implementations for full feature parity.

After changing web assets or plugin dependencies, run `npx cap sync ios` before building. Keep `ios/App/App/public` generated and untracked.
