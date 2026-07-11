# AI Review Prompt

You are analyzing a processed video folder.

Original video:
- `event-meeting.mp4`

Important files:
- `keyframes/` contains visually distinct screenshots from the video.
- `metadata/keyframes.json` contains timestamps and image paths.
- `metadata/keyframes.csv` is the spreadsheet-friendly version.
- `metadata/video_info.json` contains video duration, FPS, and extraction settings.
- `contact_sheet.jpg` gives a quick overview of the extracted frames.

No transcript file was provided. Focus on the screenshots and metadata first.
If needed, suggest how to add a transcript later.


## Task

Analyze the video based on the extracted screenshots and metadata.

Please produce:

1. A concise overall summary.
2. A chronological timeline with timestamps.
3. Key topics discussed or shown.
4. Important visual evidence from screenshots.
5. Any unclear sections that need the original video or transcript.
6. A list of follow-up questions someone could ask about this video.

## Rules

- Refer to timestamps whenever possible.
- Do not pretend to know audio details if there is no transcript.
- If the screenshots are not enough, say what extra data is needed.
- When mentioning a screenshot, cite its filename.
