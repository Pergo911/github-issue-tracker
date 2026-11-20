# Title alphabet: live evidence

Recorded 2026-11-10 against `Tarsashaz-demo/reports-sandbox` with the real Bot, by `npm run check:titles` (ticket [#32](https://github.com/Pergo911/github-issue-tracker/issues/32)). Each candidate was created as an issue title through the REST API, read back raw (REST `title`) and rendered (GraphQL `titleHTML`), and its timeline was searched for `mentioned` and `cross-referenced` events. Every issue was closed as `not_planned`.

**Plain text** means `titleHTML` contains no tag and, with its entities decoded, equals the raw title. **Validator before** is the allowlist the run used (SPEC 4.1 as first written); the five Hungarian marks `„ ‚ » « …` were added to it afterwards on this evidence, so the *candidate* rows that need only them show `rejected` here and are allowed now.

**Result.** 111 titles. The 62 the validator allowed all kept their raw title, rendered as plain text and raised no timeline event. Of the characters it rejects, only two change the rendering: a backtick pair becomes `<code>` and a `:shortcode:` becomes an emoji. `@` mentions, `#` references, URLs, e-mail addresses, Markdown emphasis, links and HTML were all left as plain text in the title, and no title produced a `mentioned` or `cross-referenced` event on any issue it named.

| Group | Title | Validator before | Raw kept | Plain text | Timeline events |
|---|---|---|---|---|---|
| hungarian | `Árvíztűrő tükörfúrógép ÁÉÍÓÖŐÚÜŰ áéíóöőúüű` | allowed | yes | yes | – |
| hungarian | `Elakadt a lift a 3. emeleten` | allowed | yes | yes | – |
| hungarian | `Gondnok (Kovács János) - 3. emelet, B lépcsőház` | allowed | yes | yes | – |
| digits | `0123456789` | allowed | yes | yes | – |
| digits | `1234` | allowed | yes | yes | – |
| digits | `12` | rejected | yes | yes | – |
| digits | `007` | allowed | yes | yes | – |
| digits | `3.14 és 2,5` | allowed | yes | yes | – |
| digits | `06 30 123 4567` | allowed | yes | yes | – |
| digits | `1-2-3` | allowed | yes | yes | – |
| digits | `2026` | allowed | yes | yes | – |
| digits | `42 42 42` | allowed | yes | yes | – |
| punctuation | `Hiba . jelzés` | allowed | yes | yes | – |
| punctuation | `Hiba , jelzés` | allowed | yes | yes | – |
| punctuation | `Hiba ! jelzés` | allowed | yes | yes | – |
| punctuation | `Hiba ? jelzés` | allowed | yes | yes | – |
| punctuation | `Hiba ( jelzés` | allowed | yes | yes | – |
| punctuation | `Hiba ) jelzés` | allowed | yes | yes | – |
| punctuation | `Hiba ' jelzés` | allowed | yes | yes | – |
| punctuation | `Hiba " jelzés` | allowed | yes | yes | – |
| punctuation | `Hiba - jelzés` | allowed | yes | yes | – |
| punctuation | `Hiba – jelzés` | allowed | yes | yes | – |
| punctuation | `Hiba — jelzés` | allowed | yes | yes | – |
| punctuation | `Hiba ‘ jelzés` | allowed | yes | yes | – |
| punctuation | `Hiba ’ jelzés` | allowed | yes | yes | – |
| punctuation | `Hiba “ jelzés` | allowed | yes | yes | – |
| punctuation | `Hiba ” jelzés` | allowed | yes | yes | – |
| punctuation | `Hiba?! (nagyon) — tényleg – „idézet” és ‘más’` | rejected | yes | yes | – |
| punctuation | `- első elem` | allowed | yes | yes | – |
| punctuation | `--- vonal` | allowed | yes | yes | – |
| punctuation | `1. pont` | allowed | yes | yes | – |
| punctuation | `(c) (r) (tm)` | allowed | yes | yes | – |
| domain-like | `example.hu` | allowed | yes | yes | – |
| domain-like | `www.example.hu` | allowed | yes | yes | – |
| domain-like | `Hiba a www.example.com oldalon` | allowed | yes | yes | – |
| domain-like | `mail.berautoapp.hu` | allowed | yes | yes | – |
| domain-like | `Lift.2.emelet` | allowed | yes | yes | – |
| domain-like | `v1.2.3` | allowed | yes | yes | – |
| domain-like | `readme.md` | allowed | yes | yes | – |
| domain-like | `192.168.0.1` | allowed | yes | yes | – |
| domain-like | `kiss.anna.example.hu` | allowed | yes | yes | – |
| domain-like | `anna.kiss.example` | allowed | yes | yes | – |
| hex | `da39a3ee5e6b4b0d3255bfef95601890afd80709` | allowed | yes | yes | – |
| hex | `da39a3e` | allowed | yes | yes | – |
| hex | `a1b2c3d4` | allowed | yes | yes | – |
| hex | `deadbeef` | allowed | yes | yes | – |
| hex | `0123456789abcdef0123456789abcdef` | allowed | yes | yes | – |
| hex | `Hiba da39a3e javítás` | allowed | yes | yes | – |
| hex | `ABCDEF1234567` | allowed | yes | yes | – |
| hex | `1234567` | allowed | yes | yes | – |
| references | `GH-1` | allowed | yes | yes | – |
| references | `GH 1` | allowed | yes | yes | – |
| references | `Issue 1` | allowed | yes | yes | – |
| references | `Pergo911` | allowed | yes | yes | – |
| references | `octocat` | allowed | yes | yes | – |
| references | `Tarsashaz-demo reports-sandbox 1` | allowed | yes | yes | – |
| references | `Tarsashaz-demo` | allowed | yes | yes | – |
| references | `Bejelentés 1 vagy 2` | allowed | yes | yes | – |
| unicode | `Café combining` | allowed | yes | yes | – |
| unicode | `Привет мир` | allowed | yes | yes | – |
| unicode | `你好世界` | allowed | yes | yes | – |
| unicode | `Ünïcödé ŉ ǅ ǆ` | allowed | yes | yes | – |
| unicode | `½ ² ③ ٣` | allowed | yes | yes | – |
| unicode | `ﬁ ligature` | allowed | yes | yes | – |
| probe | `@octocat` | rejected | yes | yes | – |
| probe | `@Pergo911 kérem` | rejected | yes | yes | – |
| probe | `@Tarsashaz-demo/team` | rejected | yes | yes | – |
| probe | `#1` | rejected | yes | yes | – |
| probe | `Duplicate of #1` | rejected | yes | yes | – |
| probe | `Tarsashaz-demo/reports-sandbox#1` | rejected | yes | yes | – |
| probe | `https://example.com/x` | rejected | yes | yes | – |
| probe | `http://example.hu` | rejected | yes | yes | – |
| probe | `mailto:a@example.hu` | rejected | yes | yes | – |
| probe | `anna@example.hu` | rejected | yes | yes | – |
| probe | `` `code` `` | rejected | yes | **no** | – |
| probe | `**bold** _it_ ~~gone~~` | rejected | yes | yes | – |
| probe | `[link](http://example.com)` | rejected | yes | yes | – |
| probe | `<b>bold</b> <script>x</script>` | rejected | yes | yes | – |
| probe | `&amp; &lt; &#35;` | rejected | yes | yes | – |
| probe | `:smile: :+1: :tada:` | rejected | yes | **no** | – |
| probe | `Idő 12:30` | rejected | yes | yes | – |
| probe | `a/b\c` | rejected | yes | yes | – |
| probe | `🙂 emoji` | rejected | yes | yes | – |
| probe | `zero<U+200B>width` | rejected | yes | yes | – |
| probe | `bidi <U+202E>abc<U+202C> end` | rejected | yes | yes | – |
| probe | `$x$ math` | rejected | yes | yes | – |
| probe | `50% off; a=b \| c * d` | rejected | yes | yes | – |
| candidate | `Hiba „idézet” után` | rejected | yes | yes | – |
| candidate | `Hiba ‚idézet’ után` | rejected | yes | yes | – |
| candidate | `Hiba »idézet« után` | rejected | yes | yes | – |
| candidate | `Hiba «idézet» után` | rejected | yes | yes | – |
| candidate | `Várjuk… sokáig` | rejected | yes | yes | – |
| candidate | `Hiba · jelzés` | rejected | yes | yes | – |
| candidate | `3/B lépcsőház` | rejected | yes | yes | – |
| candidate | `Hiba & javítás` | rejected | yes | yes | – |
| candidate | `Hiba + javítás` | rejected | yes | yes | – |
| candidate | `10% víz` | rejected | yes | yes | – |
| candidate | `Hiba; javítás` | rejected | yes | yes | – |
| candidate | `Idő: 12:30` | rejected | yes | yes | – |
| candidate | `a=b` | rejected | yes | yes | – |
| candidate | `Lift*2` | rejected | yes | yes | – |
| candidate | `a_b_c` | rejected | yes | yes | – |
| candidate | `Lift ~ 3` | rejected | yes | yes | – |
| candidate | `a \| b` | rejected | yes | yes | – |
| candidate | `Hiba [B] jelzés` | rejected | yes | yes | – |
| candidate | `Hiba {B} jelzés` | rejected | yes | yes | – |
| candidate | `Hiba $5 jelzés` | rejected | yes | yes | – |
| candidate | `Hiba ^ jelzés` | rejected | yes | yes | – |
| candidate | `Hiba § 5 jelzés` | rejected | yes | yes | – |
| candidate | `Hiba € 5 jelzés` | rejected | yes | yes | – |
| candidate | `Hiba — 12:30-kor` | rejected | yes | yes | – |
