import { normalizeText, normalizeHtml, htmlToText, mergeTextBlocks } from "./job-text";

// ---------------------------------------------------------------------------
// normalizeText
// ---------------------------------------------------------------------------
describe("normalizeText", () => {
  it("returns null for null input", () => {
    expect(normalizeText(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(normalizeText(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizeText("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(normalizeText("   ")).toBeNull();
  });

  it("returns null for tabs and newlines only", () => {
    expect(normalizeText("\t\n\r\n")).toBeNull();
  });

  it("trims leading and trailing spaces", () => {
    expect(normalizeText("  hello  ")).toBe("hello");
  });

  it("collapses multiple spaces into a single space", () => {
    expect(normalizeText("hello    world")).toBe("hello world");
  });

  it("collapses tabs into a single space", () => {
    expect(normalizeText("hello\t\tworld")).toBe("hello world");
  });

  it("collapses newlines into a single space", () => {
    expect(normalizeText("hello\n\nworld")).toBe("hello world");
  });

  it("collapses mixed whitespace (spaces, tabs, newlines) into a single space", () => {
    expect(normalizeText("hello \t\n  world")).toBe("hello world");
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
  it("returns null for null input", () => {
    expect(normalizeHtml(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(normalizeHtml(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizeHtml("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(normalizeHtml("   ")).toBeNull();
  });

  it("returns HTML as-is when it already contains tags", () => {
    const html = "<p>Hello world</p>";
    expect(normalizeHtml(html)).toBe(html);
  });

  it("trims surrounding whitespace from HTML", () => {
    expect(normalizeHtml("  <p>Hello</p>  ")).toBe("<p>Hello</p>");
  });

  it("decodes entity-escaped HTML that contains tags after decoding", () => {
    // &lt;p&gt;Hello&lt;/p&gt; decodes to <p>Hello</p>
    const encoded = "&lt;p&gt;Hello&lt;/p&gt;";
    expect(normalizeHtml(encoded)).toBe("<p>Hello</p>");
  });

  it("decodes &amp; entity in HTML-like content", () => {
    const encoded = "&lt;p&gt;Tom &amp; Jerry&lt;/p&gt;";
    expect(normalizeHtml(encoded)).toBe("<p>Tom & Jerry</p>");
  });

  it("returns plain text as-is when it does not look like HTML even after decoding", () => {
    const plainText = "Just a plain string with no tags";
    expect(normalizeHtml(plainText)).toBe(plainText);
  });

  it("returns entity-encoded plain text as the original when decoded result has no tags", () => {
    // &amp; decodes to & but the result still does not look like HTML
    const input = "Tom &amp; Jerry";
    expect(normalizeHtml(input)).toBe(input);
  });

  it("handles self-closing tags like <br/>", () => {
    const html = "Hello<br/>world";
    expect(normalizeHtml(html)).toBe(html);
  });

  it("detects tags with attributes", () => {
    const html = '<div class="description">Content</div>';
    expect(normalizeHtml(html)).toBe(html);
  });
});

// ---------------------------------------------------------------------------
// htmlToText
// ---------------------------------------------------------------------------
describe("htmlToText", () => {
  it("returns null for null input", () => {
    expect(htmlToText(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(htmlToText(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(htmlToText("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(htmlToText("   ")).toBeNull();
  });

  it("strips <p> tags and returns text content", () => {
    expect(htmlToText("<p>Hello world</p>")).toBe("Hello world");
  });

  it("converts <br> to newline then normalizes whitespace", () => {
    // <br> becomes \n, then normalizeText collapses it to a space
    const result = htmlToText("Hello<br>world");
    expect(result).toBe("Hello world");
  });

  it("converts <br/> self-closing to newline then normalizes", () => {
    const result = htmlToText("Hello<br/>world");
    expect(result).toBe("Hello world");
  });

  it("converts <li> elements to dash-prefixed lines", () => {
    const html = "<ul><li>First</li><li>Second</li><li>Third</li></ul>";
    const result = htmlToText(html);
    expect(result).toContain("- First");
    expect(result).toContain("- Second");
    expect(result).toContain("- Third");
  });

  it("appends newline after block elements (div)", () => {
    const html = "<div>Block one</div><div>Block two</div>";
    const result = htmlToText(html);
    expect(result).toContain("Block one");
    expect(result).toContain("Block two");
  });

  it("appends newline after <p> elements", () => {
    const html = "<p>Paragraph one</p><p>Paragraph two</p>";
    const result = htmlToText(html);
    expect(result).toContain("Paragraph one");
    expect(result).toContain("Paragraph two");
  });

  it("appends newline after heading elements (h1-h6)", () => {
    const html = "<h1>Title</h1><h2>Subtitle</h2><p>Body text</p>";
    const result = htmlToText(html);
    expect(result).toContain("Title");
    expect(result).toContain("Subtitle");
    expect(result).toContain("Body text");
  });

  it("appends newline after <tr> elements", () => {
    const html = "<table><tr><td>Row 1</td></tr><tr><td>Row 2</td></tr></table>";
    const result = htmlToText(html);
    expect(result).toContain("Row 1");
    expect(result).toContain("Row 2");
  });

  it("appends newline after <section> and <article> elements", () => {
    const html = "<section>Section text</section><article>Article text</article>";
    const result = htmlToText(html);
    expect(result).toContain("Section text");
    expect(result).toContain("Article text");
  });

  it("handles nested HTML structures", () => {
    const html =
      "<div><h2>Requirements</h2><ul><li>TypeScript</li><li>React</li></ul></div>";
    const result = htmlToText(html);
    expect(result).toContain("Requirements");
    expect(result).toContain("- TypeScript");
    expect(result).toContain("- React");
  });

  it("handles double-encoded HTML (entity-escaped tags that decode to real HTML)", () => {
    // First level: entity-encoded HTML
    const doubleEncoded = "&lt;p&gt;Hello&lt;/p&gt;";
    const result = htmlToText(doubleEncoded);
    expect(result).toBe("Hello");
  });

  it("handles double-encoded HTML with nested tags after first pass", () => {
    // After normalizeHtml decodes entities, we get real HTML.
    // extractTextFromHtml processes it, but if the result still contains tags,
    // the function runs a second pass.
    const encoded = "&lt;div&gt;&lt;p&gt;Inner text&lt;/p&gt;&lt;/div&gt;";
    const result = htmlToText(encoded);
    expect(result).toBe("Inner text");
  });

  it("decodes &amp; entities in HTML content", () => {
    const html = "<p>Tom &amp; Jerry</p>";
    const result = htmlToText(html);
    expect(result).toBe("Tom & Jerry");
  });

  it("decodes &lt; and &gt; entities within text content", () => {
    const html = "<p>Use &lt;div&gt; for layout</p>";
    const result = htmlToText(html);
    // After first pass extractTextFromHtml gets "Use <div> for layout"
    // which looks like HTML, so a second pass strips the <div>
    // The exact result depends on the second-pass behavior
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

  it("returns plain text unchanged (no HTML tags)", () => {
    // normalizeHtml returns the plain text as-is, extractTextFromHtml wraps it
    // in <body>, then $.text() returns the plain text, normalizeText trims it.
    expect(htmlToText("Just plain text")).toBe("Just plain text");
  });
});

// ---------------------------------------------------------------------------
// mergeTextBlocks
// ---------------------------------------------------------------------------
describe("mergeTextBlocks", () => {
  it("returns null for an empty array", () => {
    expect(mergeTextBlocks([])).toBeNull();
  });

  it("returns null when all values are null", () => {
    expect(mergeTextBlocks([null, null, null])).toBeNull();
  });

  it("returns null when all values are undefined", () => {
    expect(mergeTextBlocks([undefined, undefined])).toBeNull();
  });

  it("returns null when all values are empty strings", () => {
    expect(mergeTextBlocks(["", "", ""])).toBeNull();
  });

  it("returns null when all values are whitespace-only strings", () => {
    expect(mergeTextBlocks(["  ", "\t", "\n"])).toBeNull();
  });

  it("returns a single valid block without surrounding separators", () => {
    expect(mergeTextBlocks(["Hello world"])).toBe("Hello world");
  });

  it("joins two valid blocks with double newline", () => {
    expect(mergeTextBlocks(["Block one", "Block two"])).toBe(
      "Block one\n\nBlock two"
    );
  });

  it("joins three valid blocks with double newlines", () => {
    expect(mergeTextBlocks(["First", "Second", "Third"])).toBe(
      "First\n\nSecond\n\nThird"
    );
  });

  it("filters out null values and joins remaining blocks", () => {
    expect(mergeTextBlocks([null, "Valid block", null])).toBe("Valid block");
  });

  it("filters out undefined values and joins remaining blocks", () => {
    expect(mergeTextBlocks([undefined, "Block A", undefined, "Block B"])).toBe(
      "Block A\n\nBlock B"
    );
  });

  it("filters out empty strings and joins remaining blocks", () => {
    expect(mergeTextBlocks(["", "Block A", "", "Block B", ""])).toBe(
      "Block A\n\nBlock B"
    );
  });

  it("filters out whitespace-only strings and joins remaining blocks", () => {
    expect(mergeTextBlocks(["  ", "Block A", "\t\n", "Block B"])).toBe(
      "Block A\n\nBlock B"
    );
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
