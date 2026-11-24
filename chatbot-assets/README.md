# ELIZA source

`eliza-hay.js` comes from the [ELIZA Archaeology Project](https://github.com/critical-code-studies/ELIZA/blob/1cd4ae4b64fd4b2336fb736463df16e4ed80165b/assets/eliza-hay.js). It contains Anthony and Max Hay’s ELIZA engine v1.00, the project’s structured tracer, and Hay’s transcription of the DOCTOR script from Weizenbaum’s 1966 article.

The Hay engine is distributed under CC0 1.0. See [LICENSE-eliza.txt](LICENSE-eliza.txt). The transcribed script retains the copyright notice from the upstream file.

The upstream file’s SHA-256 before local changes was `77b3f08b9b7ac63d7ec0f6bfb062995c09d8ba1918ce83c1a17ff63ac9065137`.

Local additions report the clause, patterns, and reply options used in each turn. Lesson controls can edit a keyword group’s triggers, a pattern, or a first reply, and can add a new one-rule keyword group to a session. The built-in DOCTOR script and matching logic are as supplied upstream. The page displays replies in sentence case and supplies punctuation for the terminal’s unpunctuated output.
