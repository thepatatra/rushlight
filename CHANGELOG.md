# Changelog

Rushlight is still in 0.x versions: it is used and improved regularly, and the design is still being polished.

## 0.10.0 — first public release
- The panel is available in English and French. It follows Premiere's language, and can be changed in
  Settings > Language.
- Backups, markers and messages are created in the panel's language. Markers created in either language (and by
  earlier versions) are still recognized.
- Ready-to-install release package: download, unzip, run `install.bat`.

## 0.9.0
- Highlights are numbered the same way in the panel list and on the orange markers, best first.
- The highlight list is read back from the sequence markers, so it survives closing the panel or Premiere.
- A cross next to each highlight lets you ignore it: its marker turns white and it is never suggested again.
- Searching again suggests new highlights (numbering continues) instead of the same ones.
- A highlight now has to clearly stand out from the rest of the recording. When none are left, the extension says
  so and the search stops.
- "Clear all highlights" button.

## 0.8.x
- Words and sounds that fade out slowly are no longer cut too early: a silence only starts when the sound drops
  well below the threshold.
- Gaming mode: padding after raised to 400 ms, to let reactions and action scenes finish.
- After cutting, video and audio pieces are linked again; "Relink audio and video" button for sequences cut
  earlier.
- New logo, shown in the panel title and as the panel icon in Premiere.
- The project was called AutoCut Lite during early development. It was renamed Rushlight to have a name of its
  own and avoid any confusion with existing software. Zone markers from that time are still recognized.

## 0.7.x
- New cutting method: every razor cut is checked before anything is removed, pieces are removed when their middle
  falls in a silence, the timeline is closed up based on the gaps actually left, and clips are never moved twice.
  After each zone, the extension checks that no clip overlaps another, and stops otherwise.
- Markers follow cuts and closing up.
- Choose which 1-hour zone to cut; zones already cut are marked in green and never cut again.
- "Create a best-of sequence" button; "Mark as already cut" button.
- A backup before each zone and before closing gaps.

## 0.6.0
- Ready-made modes: Gaming, Vlog / face cam, Podcast / interview, Best of.

## 0.5.0
- Automatic project backup before every change, in a folder next to the project.

## 0.4.0
- Automatic setting over the whole sequence (silence / quiet / intense), analysis of all audio tracks, optional
  removal of quiet passages, cutting in 1-hour chunks, closing timeline gaps.

## 0.3.0
- Highlights (louder voice, fast speech, exclamations, likely laughter) with orange markers.

## 0.2.0
- Automatic threshold, live preview when moving the slider.

## 0.1.0
- First version: silence removal with ffmpeg.
