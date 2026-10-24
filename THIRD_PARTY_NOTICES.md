# Third-party notices

The application code is MIT licensed under [LICENSE](LICENSE). Dependencies retain their own terms. This inventory records observed local evidence; it is not final license or redistribution clearance.

## Collection and scope

Collected offline on 18 October 2026 from pinned `package.json`, both documents of `pnpm-lock.yaml`, the matching installed application lock, current dependency symlinks, and installed package metadata and root LICENSE/NOTICE/copyright files. No `pnpm` command, install, network lookup or model inspection ran. [docs/licenses.json](docs/licenses.json) contains the normalized graph, relative evidence paths, hashes, declared license metadata, unresolved entries and exact deduplicated license/notice texts. This is historical evidence, not a fresh-install audit of the public tree; source-file hashes describe the historical inputs.

The committed application document matches the installed lock byte-for-byte. The graph contains **6 production packages** (5 direct plus scheduler), **227 development-only packages** (13 direct), and 15 separate package-manager bootstrap lock entries. Of 233 application package versions, 183 are installed in the current closure; 50 optional platform packages are not installed and have no locally verified license declarations. Eight old installed copies are not reachable from current roots and are recorded separately. No fresh-install reproducibility claim follows from this comparison.

`pnpm start` invokes the development dependency `tsx`; its operational closure is recorded separately (35 locked package versions including optional platforms, 10 currently installed). A production-only install is insufficient for that command. Production/development below describes manifest dependency scope, not a complete deployed artifact bill of materials.

## Production dependency closure

| Package | Version | Declared license | Scope |
|---|---|---|---|
| @hono/node-server | 1.19.17 | MIT | Direct |
| hono | 4.13.13 | MIT | Direct |
| react-dom | 19.3.1 | MIT | Direct |
| react | 19.3.1 | MIT | Direct |
| scheduler | 0.28.0 | MIT | Transitive |
| zod | 4.6.7 | MIT | Direct |

The following production license texts are copied verbatim from the installed files, grouped only where their SHA256 is identical. Preserve these copyright and permission notices in redistributions that include the corresponding software. Exact source paths/hashes remain in the JSON inventory.

### `@hono/node-server@1.19.17`

```text
MIT License

Copyright (c) 2022 - present, Yusuke Wada and Hono contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### `hono@4.13.13`

```text
MIT License

Copyright (c) 2021 - present, Yusuke Wada and Hono contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### `react-dom@19.3.1`, `react@19.3.1`, `scheduler@0.28.0`

```text
MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### `zod@4.6.7`

```text
MIT License

Copyright (c) 2025 Colin McDonnell

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Development and bundled notices

Declared licenses across the 183 current installed application package versions (including production) are listed below. These are metadata declarations, not inferred licenses for every embedded component. Vite, Rollup, Vitest and TypeScript include additional bundled notices; the full observed root license/notice files are preserved in `licenseTexts` in the JSON inventory, including TypeScript’s `ThirdPartyNoticeText.txt` and Playwright’s NOTICE files. Retain the applicable full license/notice texts when distributing those tools or embedded components.

| Declared license | Installed package versions |
|---|---|
| 0BSD | 1 |
| Apache-2.0 | 9 |
| BSD-2-Clause | 2 |
| BSD-3-Clause | 2 |
| BlueOak-1.0.0 | 1 |
| CC-BY-4.0 | 1 |
| CC0-1.0 | 1 |
| ISC | 11 |
| MIT | 153 |
| MIT-0 | 2 |

This includes Apache-2.0 tools, ISC/BSD packages, BlueOak-1.0.0 `lru-cache`, CC-BY-4.0 `caniuse-lite`, CC0-1.0 `mdn-data`, MIT-0 packages and 0BSD `tslib`. Development/transitive packages are not all MIT. The package-specific source/author fields, original attribution text and terms are retained in the inventory; CC-BY attribution and any bundled notices require review for the actual distributed artifact.

Unresolved local evidence:

- `@esbuild/darwin-x64@0.28.2` and `@rollup/rollup-darwin-x64@4.64.7` declare MIT but have no observed root license/notice file.
- `saxes@6.0.0` declares ISC and `stackback@0.0.2` declares MIT but have no observed root license/notice file. No copyright text was reconstructed from author names.
- The 50 skipped optional platform packages and 15 pnpm bootstrap lock entries were not inspected as installed artifacts; their license metadata/text is explicitly unresolved.
- Root-file collection is bounded. It does not audit every source header or nested vendored file, generated bundle composition, browser binaries, Node/OS components, or model/runtime artifacts. Required additional notices for a future release remain a separate review.

## Documentation and synthetic data

Upstream [Qloo documentation](https://docs.qloo.com/) is linked for attribution, not redistributed. The project-maintained parameter facts in `fixtures/param-schema/definitions.json` contain validation facts without copied descriptive prose. Committed Qloo and LLM fixtures are hand-written, fictional examples. Never commit live Qloo responses or private caches.

## Separately configured LLM services

No model weights or inference runtime are bundled. Any configured LLM provider or separately installed model/runtime has its own terms; the application's MIT license does not cover those services or artifacts.
