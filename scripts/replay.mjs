process.env.CFR_READ_ONLY_DEMO = '1';
process.env.PORT ||= '4318';
await import('../server.mjs');
