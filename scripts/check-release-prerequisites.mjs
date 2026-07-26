const results = {
  check: process.env.REALDONE_CHECK_RESULT,
  compatibility: process.env.REALDONE_COMPATIBILITY_RESULT,
};

const failed = Object.entries(results)
  .filter(([, result]) => result !== "success")
  .map(([name, result]) => ({ name, result: result ?? "missing" }));

process.stdout.write(`${JSON.stringify({ passed: failed.length === 0, results, failed })}\n`);
if (failed.length > 0) process.exitCode = 1;
