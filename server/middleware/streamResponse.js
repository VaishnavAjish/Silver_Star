const { Transform } = require('stream');
const { logger } = require('./logger');

const CHUNK_SIZE = 1000;

function createJsonStream() {
  let first = true;
  return new Transform({
    objectMode: true,
    transform(rows, encoding, callback) {
      for (const row of rows) {
        if (first) {
          this.push(first ? '[' : ',');
          first = false;
        } else {
          this.push(',');
        }
        this.push(JSON.stringify(row));
      }
      callback();
    },
    flush(callback) {
      this.push(first ? '[]' : ']');
      callback();
    },
  });
}

function streamResponse(req, res, next) {
  res.streamJson = function (rowsPromise, options = {}) {
    const { statusCode = 200, maxRows = 100000 } = options;
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Transfer-Encoding': 'chunked',
      'Cache-Control': 'no-cache',
      'x-stream': '1',
    });

    let rowCount = 0;
    const stream = createJsonStream();
    stream.pipe(res);

    rowsPromise
      .then(async (rows) => {
        let batch = [];
        for await (const row of rows) {
          batch.push(row);
          rowCount++;
          if (batch.length >= CHUNK_SIZE) {
            stream.write(batch);
            batch = [];
          }
          if (rowCount >= maxRows) {
            if (batch.length > 0) stream.write(batch);
            stream.end();
            logger.info(`Stream response truncated at ${maxRows} rows`, { url: req.originalUrl, maxRows });
            return;
          }
        }
        if (batch.length > 0) stream.write(batch);
        stream.end();
      })
      .catch((err) => {
        logger.error('Stream error', { error: err, url: req.originalUrl });
        if (!res.headersSent) {
          res.status(500).json({ error: 'Stream processing failed' });
        } else {
          res.end();
        }
      });
  };

  next();
}

module.exports = { streamResponse, createJsonStream };
