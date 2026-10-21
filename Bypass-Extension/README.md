# Bypass 0.9.0

Every feature is free. No account, trial, payment service or database is required.

## Clean

**Protect this website** turns all changes on or off for the current hostname. Turning it off restores hidden elements and assisted playback. Feature choices remain saved.

**Clean website distractions** hides supported cookie banners, unsolicited newsletter/support popups and labeled sticky ads. Recognized reject controls may be clicked. Hiding a banner does not itself reject cookies or block tracking. Checkout, sign-in, age checks and active chats are protected.

**Assist YouTube ads** accelerates and mutes supported ads, clicks visible enabled Skip Ad controls when available, and restores the original speed and sound afterward. Consecutive ads rearm assistance without toggling it. YouTube decides when skipping is available; the extension cannot force an unskippable ad to offer a skip button.

**Streaming controls** optionally skip recognized intros, recaps and ending/next-episode controls on supported Netflix, Prime Video and Disney+ web players. These choices start off. Support depends on the player, language and available controls.

## Autopilot

- **Study** hides supported YouTube feeds, Shorts, recommendations and comments.
- **Work** hides supported YouTube feeds and Shorts.
- **Relax / Off** restores mode-based hiding. Personal rules continue working until removed or site protection is turned off.
- **Personal website cleanup** lets you select one small distraction to hide on that hostname. Remove its rule to restore it. Main content, forms, navigation and video players are protected.
- **Custom media button** selects a button for exact English intro/recap/next-episode matching while a suitable video is playing. It never guarantees universal player support.
- **Schedules** use the computer's local time. Overnight ranges work; the last matching schedule wins. The manual mode returns outside schedules.
- **Daily website limits** show dismissible reminders based on approximate foreground use. They do not hard-block websites.
- **Private progress** records local actions and approximate focus time, not guaranteed time saved.

Controls are available immediately and work offline. Opening them in a full tab keeps them available while using another window. The standard toolbar popup closes when it loses focus; processing continues.

## Upgrade

Load the new files using the existing extension ID. Existing site choices and cleanup counters stay in place. Older personal rules, schedules, limits and progress migrate automatically. Expired trial records no longer restrict access. Retired local account credentials and payment refresh alarms are removed on installation/update. Previous source remains recoverable from Git history.

## Manual checks

1. On a supported cookie-banner site, turn protection and cleanup on. Check that the banner disappears, scrolling works, and ordinary buttons/forms remain usable.
2. Turn site protection off. Hidden elements should return. Turn it on again and verify cleanup resumes.
3. On YouTube, enable ad assistance and watch several ad-supported videos, including consecutive ads. Supported ads should accelerate quietly, eligible Skip Ad buttons should be clicked, and normal content should retain your original speed and sound.
4. Turn assistance off during an ad. The extension's playback changes should stop and restore immediately.
5. On a supported streaming service, enable intro skipping. Verify it only acts on the recognized player control; repeat on the following episode.
6. Open Autopilot. Save a mode, schedule, personal rule and daily reminder. Close/reopen the UI and restart the browser to verify persistence.
7. Remove a personal rule and turn site protection off/on. Confirm the selected element restores and the rest of the page remains usable.
8. Disconnect the internet after opening a test page. Local settings and personal cleanup should still work. Online video playback itself still needs internet.

## Privacy and limits

No browsing data, accounts or local activity are transmitted by the extension. It uses local storage and browser messaging; there is no application backend. Broad website access is needed to apply cleanup and per-site controls.

Automatic tests cover DOM fixtures, busy pages, restoration, sender authorization, storage concurrency, migration, offline settings and accessibility rules. They do not certify every website, prove retention or guarantee fixed execution time on every device. Website changes can require compatibility updates.
