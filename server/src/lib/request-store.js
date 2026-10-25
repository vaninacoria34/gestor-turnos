const { AsyncLocalStorage } = require('node:async_hooks');

// One cache per request/transaction; never share stale Firestore data across users.
const requestStore = new AsyncLocalStorage();
let queue = Promise.resolve();

function serialize(work) {
  const result = queue.then(work);
  queue = result.catch(() => {});
  return result;
}

function installAsyncRoutes(app, db) {
  for (const method of ['get', 'post', 'put', 'delete']) {
    const original = app[method].bind(app);
    app[method] = (path, ...handlers) => {
      if (!handlers.length) return original(path);
      const handler = handlers.pop();
      return original(path, ...handlers, async (req, res, next) => {
        const mutates = method !== 'get';
        try {
          const run = async () => {
            const json = res.json.bind(res);
            let body;
            let sent = false;
            // Send success only after Firestore has committed all writes.
            res.json = (payload) => { body = payload; sent = true; return res; };
            const execute = async (transaction) => requestStore.run({ cache: new Map(), writes: new Map(), transaction }, async () => {
              body = undefined;
              sent = false;
              res.statusCode = 200;
              await handler(req, res, (error) => { if (error) throw error; });
              const state = requestStore.getStore();
              if (transaction && res.statusCode < 400) {
                for (const { ref, data } of state.writes.values()) {
                  if (data === null) transaction.delete(ref);
                  else transaction.set(ref, data);
                }
              }
            });
            try {
              if (mutates && db?.runTransaction) await db.runTransaction(execute);
              else await execute(null);
            } finally { res.json = json; }
            if (sent && !res.headersSent) json(body);
          };
          if (mutates) await serialize(run);
          else await run();
        } catch (error) { next(error); }
      });
    };
  }
}

module.exports = { requestStore, installAsyncRoutes };
