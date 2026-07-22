export default {
  apiVersion: "1.0",
  name: "storage-fixture",
  async verifyProvider(expectation) {
    const reference = "env" in expectation.reference
      ? process.env[expectation.reference.env]
      : expectation.reference.value;
    return {
      found: reference === "RD_TEST_OBJECT",
      detail: "The fixture storage index was queried.",
      metadata: { fixture: true }
    };
  }
};
