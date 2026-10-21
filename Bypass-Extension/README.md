# Bypass 0.9.4

Only the original Free features remain. Autopilot, personal rules, focus modes, schedules, website limits, trials and billing have been removed. No account or backend is required.

## Controls

**Protect this website** turns all changes on or off for this hostname. Turning it off restores hidden elements and assisted playback. Feature choices remain saved.

**Clean website distractions** handles supported cookie banners, unsolicited newsletter/support popups and labeled sticky ads. Recognized reject controls may be clicked. Hiding a banner does not itself reject cookies or block tracking. Checkout, sign-in, age checks and active chats remain available.

**Assist YouTube ads** monitors recognized ad breaks, accelerates and mutes supported ads, and rechecks speed when consecutive ads reset it. It clicks a visible, enabled Skip Ad control when available, then restores normal playback. YouTube controls skip availability. Programmatic clicks may be ignored by some player versions; the extension cannot manufacture trusted human input.

Deliberate speed or mute changes through recognized player controls are respected during the current ad. Turn assistance off to stop it immediately. Unavailable playback rates use bounded retries instead of a tight write loop.

**Streaming controls** optionally skip recognized intros, recaps and ending/next-episode buttons on supported Netflix, Prime Video and Disney+ web players. These choices start off. Support depends on the player, language and available controls.

**Private activity** shows local actions, including ad breaks assisted. A contiguous multi-ad break counts as one episode, rather than inflating the count for each acceleration attempt. Counters do not represent guaranteed time saved.

The browser toolbar popup closes when it loses focus. Cleanup and video assistance continue with it closed.

## Test after updating

1. Reload the extension and refresh YouTube. Enable website protection and ad assistance.
2. Watch an ad-supported video with consecutive ads. Both should accelerate quietly without touching the toggle.
3. When Skip Ad becomes available, check that it is clicked automatically. Normal content should return to its original speed and sound.
4. Disable assistance during an ad. Its playback changes should restore immediately and stay stopped.
5. On a supported cookie-banner site, verify cleanup, natural scrolling, ordinary forms and checkout. Turn site protection off and check that hidden elements return.
6. On a supported streaming service, enable intro skipping and repeat across episodes.
7. Close the popup, navigate between videos, and restart the browser. Settings and counters should persist.

Existing site settings and cleanup counters are preserved when using the same extension ID. Former paid-tool preferences are no longer read or used. Older code remains recoverable in Git history.

## Privacy and testing limits

The extension sends no browsing data or local activity to a backend. Broad website access is needed for per-site cleanup. Automated checks cover fixture markup, native playback properties, installed extension messaging, storage, lifecycle, safety and accessibility rules. These checks cannot certify every live website or guarantee execution time on every device.
