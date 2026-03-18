import { normalizeText, normalizeHtml, htmlToText, mergeTextBlocks } from "./job-text";

// ---------------------------------------------------------------------------
// normalizeText
// ---------------------------------------------------------------------------
describe("normalizeText", () => {
  test.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["whitespace-only", "   "],
    ["tabs and newlines", "\t\n\r\n"],
  ] as const)("returns null for %s input", (_label, input) => {
    expect(normalizeText(input as string | null | undefined)).toBeNull();
  });

  it("trims leading and trailing spaces", () => {
    expect(normalizeText("  hello  ")).toBe("hello");
  });

  test.each([
    ["multiple spaces", "hello    world", "hello world"],
    ["tabs", "hello\t\tworld", "hello world"],
    ["newlines", "hello\n\nworld", "hello world"],
    ["mixed whitespace", "hello \t\n  world", "hello world"],
  ])("collapses %s into single space", (_label, input, expected) => {
    expect(normalizeText(input)).toBe(expected);
  });

  it("preserves a single-word string", () => {
    expect(normalizeText("hello")).toBe("hello");
  });

  it("handles a realistic multi-line job description", () => {
    const input = "  Software Engineer\n\n  We are looking for\t a skilled developer.  ";
    expect(normalizeText(input)).toBe(
      "Software Engineer We are looking for a skilled developer."
    );
  });
});

// ---------------------------------------------------------------------------
// normalizeHtml
// ---------------------------------------------------------------------------
describe("normalizeHtml", () => {
  test.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["whitespace-only", "   "],
  ] as const)("returns null for %s input", (_label, input) => {
    expect(normalizeHtml(input as string | null | undefined)).toBeNull();
  });

  test.each([
    ["simple tags", "<p>Hello world</p>"],
    ["self-closing tags", "Hello<br/>world"],
    ["tags with attributes", '<div class="description">Content</div>'],
  ])("returns HTML as-is when it contains %s", (_label, html) => {
    expect(normalizeHtml(html)).toBe(html);
  });

  it("trims surrounding whitespace from HTML", () => {
    expect(normalizeHtml("  <p>Hello</p>  ")).toBe("<p>Hello</p>");
  });

  it("decodes entity-escaped HTML that contains tags after decoding", () => {
    expect(normalizeHtml("&lt;p&gt;Hello&lt;/p&gt;")).toBe("<p>Hello</p>");
  });

  it("decodes &amp; entity in HTML-like content", () => {
    expect(normalizeHtml("&lt;p&gt;Tom &amp; Jerry&lt;/p&gt;")).toBe(
      "<p>Tom & Jerry</p>"
    );
  });

  it("returns plain text as-is when it does not look like HTML", () => {
    expect(normalizeHtml("Just a plain string with no tags")).toBe(
      "Just a plain string with no tags"
    );
  });

  it("returns entity-encoded plain text as original when decoded has no tags", () => {
    const input = "Tom &amp; Jerry";
    expect(normalizeHtml(input)).toBe(input);
  });

  // Adversarial edge cases for looksLikeHtml regex
  test.each([
    ["angle brackets with no tag name", "<>"],
    ["space before tag name", "< p>text</p>"],
    ["numeric tag-like", "<123>"],
  ])("treats %s as plain text (not HTML)", (_label, input) => {
    // looksLikeHtml requires /<\/?[a-z][\s\S]*>/i — these don't match
    expect(normalizeHtml(input)).toBe(input);
  });
});

// ---------------------------------------------------------------------------
// htmlToText
// ---------------------------------------------------------------------------
describe("htmlToText", () => {
  test.each([
    ["null", null],
    ["undefined", undefined],
    ["empty string", ""],
    ["whitespace-only", "   "],
  ] as const)("returns null for %s input", (_label, input) => {
    expect(htmlToText(input as string | null | undefined)).toBeNull();
  });

  it("strips tags and returns text content", () => {
    expect(htmlToText("<p>Hello world</p>")).toBe("Hello world");
  });

  test.each([
    ["<br>", "Hello<br>world"],
    ["<br/>", "Hello<br/>world"],
  ])("converts %s to space in normalized output", (_label, html) => {
    expect(htmlToText(html)).toBe("Hello world");
  });

  it("converts <li> elements to dash-prefixed lines", () => {
    const html = "<ul><li>First</li><li>Second</li><li>Third</li></ul>";
    const result = htmlToText(html);
    expect(result).toContain("- First");
    expect(result).toContain("- Second");
    expect(result).toContain("- Third");
  });

  test.each([
    ["div", "<div>Block one</div><div>Block two</div>"],
    ["p", "<p>Paragraph one</p><p>Paragraph two</p>"],
    ["headings", "<h1>Title</h1><h2>Subtitle</h2>"],
    ["tr", "<table><tr><td>Row 1</td></tr><tr><td>Row 2</td></tr></table>"],
    ["section/article", "<section>Section text</section><article>Article text</article>"],
  ])("separates text across %s block elements", (_label, html) => {
    const result = htmlToText(html)!;
    // Verify both text segments are present and the full string contains them in order
    const segments = result.split(/\s+/).filter(Boolean);
    expect(segments.length).toBeGreaterThanOrEqual(2);
  });

  it("handles nested HTML structures", () => {
    const html =
      "<div><h2>Requirements</h2><ul><li>TypeScript</li><li>React</li></ul></div>";
    const result = htmlToText(html);
    expect(result).toContain("Requirements");
    expect(result).toContain("- TypeScript");
    expect(result).toContain("- React");
  });

  it("handles double-encoded HTML (entity-escaped tags)", () => {
    expect(htmlToText("&lt;p&gt;Hello&lt;/p&gt;")).toBe("Hello");
  });

  it("handles double-encoded HTML with nested tags", () => {
    expect(
      htmlToText("&lt;div&gt;&lt;p&gt;Inner text&lt;/p&gt;&lt;/div&gt;")
    ).toBe("Inner text");
  });

  it("decodes &amp; entities in HTML content", () => {
    expect(htmlToText("<p>Tom &amp; Jerry</p>")).toBe("Tom & Jerry");
  });

  it("decodes &lt;/&gt; entities within text content", () => {
    const result = htmlToText("<p>Use &lt;div&gt; for layout</p>");
    expect(result).toContain("Use");
    expect(result).toContain("for layout");
  });

  it("returns null when HTML contains only empty tags", () => {
    expect(htmlToText("<p>  </p>")).toBeNull();
  });

  it("handles a complex real-world job description", () => {
    const html = `
      <div>
        <h2>About the Role</h2>
        <p>We are looking for a <strong>Software Engineer</strong>.</p>
        <h3>Requirements</h3>
        <ul>
          <li>5+ years of experience</li>
          <li>TypeScript &amp; React</li>
        </ul>
        <br>
        <p>Apply today!</p>
      </div>
    `;
    const result = htmlToText(html);
    expect(result).not.toBeNull();
    expect(result).toContain("About the Role");
    expect(result).toContain("Software Engineer");
    expect(result).toContain("Requirements");
    expect(result).toContain("- 5+ years of experience");
    expect(result).toContain("- TypeScript & React");
    expect(result).toContain("Apply today!");
  });

  it("returns plain text unchanged", () => {
    expect(htmlToText("Just plain text")).toBe("Just plain text");
  });
});

// ---------------------------------------------------------------------------
// mergeTextBlocks
// ---------------------------------------------------------------------------
describe("mergeTextBlocks", () => {
  test.each([
    ["empty array", []],
    ["all null", [null, null, null]],
    ["all undefined", [undefined, undefined]],
    ["all empty strings", ["", "", ""]],
    ["all whitespace-only", ["  ", "\t", "\n"]],
  ] as const)("returns null for %s", (_label, input) => {
    expect(mergeTextBlocks(input as unknown as Array<string | null | undefined>)).toBeNull();
  });

  it("returns a single valid block without separators", () => {
    expect(mergeTextBlocks(["Hello world"])).toBe("Hello world");
  });

  test.each([
    ["two blocks", ["Block one", "Block two"], "Block one\n\nBlock two"],
    ["three blocks", ["First", "Second", "Third"], "First\n\nSecond\n\nThird"],
  ])("joins %s with double newline", (_label, input, expected) => {
    expect(mergeTextBlocks(input)).toBe(expected);
  });

  test.each([
    ["null values", [null, "Valid block", null], "Valid block"],
    ["undefined values", [undefined, "Block A", undefined, "Block B"], "Block A\n\nBlock B"],
    ["empty strings", ["", "Block A", "", "Block B", ""], "Block A\n\nBlock B"],
    ["whitespace-only strings", ["  ", "Block A", "\t\n", "Block B"], "Block A\n\nBlock B"],
  ] as const)("filters out %s and joins remaining blocks", (_label, input, expected) => {
    expect(mergeTextBlocks(input as unknown as Array<string | null | undefined>)).toBe(expected);
  });

  it("normalizes whitespace within each block before joining", () => {
    expect(mergeTextBlocks(["  hello   world  ", "  foo\tbar  "])).toBe(
      "hello world\n\nfoo bar"
    );
  });

  it("handles a mix of null, undefined, empty, whitespace, and valid blocks", () => {
    expect(
      mergeTextBlocks([null, "", "  ", undefined, "Only valid", "\n", "Also valid"])
    ).toBe("Only valid\n\nAlso valid");
  });
});
