<?php

namespace App\RichText;

use League\CommonMark\Node\Inline\AbstractStringContainer;

/**
 * A `@` or `-` written with a backslash in Markdown (`\@mara`, `WEB\-47`): text that is never a mention or a key. Not
 * a commonmark Text, so commonmark never joins it with the text around it, and MentionsAndReferences reads that text
 * as the pieces before and after it.
 */
final class EscapedCharacter extends AbstractStringContainer {}
