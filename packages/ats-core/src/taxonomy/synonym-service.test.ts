import { expandTerms, canonicalize } from "./synonym-service";
import type { SynonymGroup } from "./synonym-service";

// ---------------------------------------------------------------------------
// Fixtures -- mirrors the seed data from the plan
// ---------------------------------------------------------------------------

const CRYPTO_GROUP: SynonymGroup = {
  canonical: "crypto",
  synonyms: ["crypto", "cryptocurrency", "bitcoin", "digital_currency"],
  umbrellaKey: "crypto_ecosystem",
};

const WEB3_GROUP: SynonymGroup = {
  canonical: "web3",
  synonyms: ["web3", "blockchain", "defi", "decentralized_finance"],
  umbrellaKey: "crypto_ecosystem",
};

const EXCHANGE_GROUP: SynonymGroup = {
  canonical: "exchange",
  synonyms: ["exchange", "crypto_exchange", "digital_exchange"],
  umbrellaKey: "crypto_ecosystem",
};

const FINTECH_GROUP: SynonymGroup = {
  canonical: "fintech",
  synonyms: ["fintech", "financial_technology", "financial_tech"],
  umbrellaKey: null,
};

const PAYMENTS_GROUP: SynonymGroup = {
  canonical: "payments",
  synonyms: ["payments", "payment_processing", "payment_infrastructure"],
  umbrellaKey: null,
};

/** All test fixture groups. */
const ALL_GROUPS: SynonymGroup[] = [
  CRYPTO_GROUP,
  WEB3_GROUP,
  EXCHANGE_GROUP,
  FINTECH_GROUP,
  PAYMENTS_GROUP,
];

// ---------------------------------------------------------------------------
// canonicalize()
// ---------------------------------------------------------------------------

describe("canonicalize", () => {
  test('returns canonical for a known synonym: "cryptocurrency" -> "crypto"', () => {
    expect(canonicalize(ALL_GROUPS, "cryptocurrency")).toBe("crypto");
  });

  test('returns canonical unchanged when already canonical: "crypto" -> "crypto"', () => {
    expect(canonicalize(ALL_GROUPS, "crypto")).toBe("crypto");
  });

  test("passes through unknown terms unchanged (lowercased)", () => {
    expect(canonicalize(ALL_GROUPS, "unknown_term")).toBe("unknown_term");
  });

  test("is case insensitive", () => {
    expect(canonicalize(ALL_GROUPS, "CRYPTOCURRENCY")).toBe("crypto");
    expect(canonicalize(ALL_GROUPS, "Bitcoin")).toBe("crypto");
  });

  test("returns lowercased unknown term", () => {
    expect(canonicalize(ALL_GROUPS, "SomeNewThing")).toBe("somenewthing");
  });

  test("handles empty groups array", () => {
    expect(canonicalize([], "crypto")).toBe("crypto");
  });
});

// ---------------------------------------------------------------------------
// expandTerms()
// ---------------------------------------------------------------------------

describe("expandTerms", () => {
  // -- Umbrella expansion ---------------------------------------------------

  test("expands a synonym through its umbrella to all linked groups", () => {
    const result = expandTerms(ALL_GROUPS, ["cryptocurrency"]);

    // Should contain terms from all three crypto_ecosystem groups
    expect(result).toContain("crypto");
    expect(result).toContain("cryptocurrency");
    expect(result).toContain("bitcoin");
    expect(result).toContain("digital_currency");
    expect(result).toContain("web3");
    expect(result).toContain("blockchain");
    expect(result).toContain("defi");
    expect(result).toContain("decentralized_finance");
    expect(result).toContain("exchange");
    expect(result).toContain("crypto_exchange");
    expect(result).toContain("digital_exchange");
  });

  test("umbrella expansion is bidirectional (web3 -> crypto terms too)", () => {
    const result = expandTerms(ALL_GROUPS, ["blockchain"]);

    expect(result).toContain("crypto");
    expect(result).toContain("web3");
    expect(result).toContain("exchange");
  });

  // -- Non-umbrella expansion -----------------------------------------------

  test("expands within group only when no umbrella key", () => {
    const result = expandTerms(ALL_GROUPS, ["fintech"]);

    expect(result).toEqual(
      expect.arrayContaining([
        "fintech",
        "financial_technology",
        "financial_tech",
      ]),
    );
    expect(result).toHaveLength(3);
  });

  test("non-umbrella group does not leak into other groups", () => {
    const result = expandTerms(ALL_GROUPS, ["fintech"]);

    expect(result).not.toContain("payments");
    expect(result).not.toContain("crypto");
  });

  // -- Edge cases -----------------------------------------------------------

  test("empty input returns empty output", () => {
    expect(expandTerms(ALL_GROUPS, [])).toEqual([]);
  });

  test("unknown term passes through unchanged (lowercased)", () => {
    const result = expandTerms(ALL_GROUPS, ["quantum_computing"]);

    expect(result).toEqual(["quantum_computing"]);
  });

  test("is case insensitive", () => {
    const result = expandTerms(ALL_GROUPS, ["CRYPTO"]);

    expect(result).toContain("crypto");
    expect(result).toContain("cryptocurrency");
    expect(result).toContain("web3");
  });

  test("deduplicates when multiple input terms map to overlapping groups", () => {
    const result = expandTerms(ALL_GROUPS, ["crypto", "web3"]);

    // Both map to the same umbrella -- should not produce duplicates
    const unique = new Set(result);
    expect(result).toHaveLength(unique.size);
  });

  test("deduplicates when input term itself is also in a synonym list", () => {
    // "crypto" is both input and in CRYPTO_GROUP.synonyms
    const result = expandTerms(ALL_GROUPS, ["crypto"]);

    const cryptoCount = result.filter((t) => t === "crypto").length;
    expect(cryptoCount).toBe(1);
  });

  test("handles multiple independent terms", () => {
    const result = expandTerms(ALL_GROUPS, ["fintech", "payments"]);

    expect(result).toContain("fintech");
    expect(result).toContain("financial_technology");
    expect(result).toContain("payments");
    expect(result).toContain("payment_processing");
  });

  test("mixes known and unknown terms", () => {
    const result = expandTerms(ALL_GROUPS, [
      "fintech",
      "quantum_computing",
    ]);

    expect(result).toContain("fintech");
    expect(result).toContain("financial_technology");
    expect(result).toContain("quantum_computing");
  });

  test("handles empty groups array (all terms pass through)", () => {
    const result = expandTerms([], ["crypto", "web3"]);

    expect(result).toEqual(["crypto", "web3"]);
  });

  test("all output terms are lowercased", () => {
    const result = expandTerms(ALL_GROUPS, ["FINTECH", "UNKNOWN"]);

    for (const term of result) {
      expect(term).toBe(term.toLowerCase());
    }
  });
});
