# StudyHackerTube

Upload a course PDF. StudyHackerTube identifies the course and its chapters, then points you to
the exact [HackerTube](https://hackertube.org) video segments, with timestamps, that explain each part.

- Runs in the browser: your PDF never leaves your machine.
- Free to run: static site on GitHub Pages, no paid servers or APIs.
- Decides what to watch; plays it with the privacy-enhanced YouTube embed and links back to
  YouTube and HackerTube.

## Develop

```sh
npm install
npm run dev      # local server with hot reload
npm run build    # type-check, then build to dist/
```

Raw data is not in git. Download the HackerTube data export and put its files in `data/raw/`.

## Credits and licenses

- Code: MIT, see [LICENSE](LICENSE).
- Video data: [HackerTube](https://hackertube.org), released under the
  [Open Data Commons Attribution License (ODC-By) v1.0](https://opendatacommons.org/licenses/by/1-0/),
  derived from the [open-index/hacker-news](https://huggingface.co/datasets/open-index/hacker-news)
  dataset. Hacker News data is provided by Y Combinator; comments remain the work of their authors.
- Video titles and channel names belong to their creators. Not affiliated with YouTube, Google,
  HackerTube, Hacker News or Y Combinator. YouTube metadata is not redistributed.
