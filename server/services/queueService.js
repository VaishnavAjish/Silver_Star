const { logger } = require('../middleware/logger');
const { recordQueueJob, recordQueueJobFailed } = require('../middleware/metrics');

let Queue = null;
let jobs = new Map();
let jobIdCounter = 0;

try {
  Queue = require('bull');
} catch (e) {
  logger.warn('Bull not available — using in-memory queue fallback');
}

const QUEUE_NAME = process.env.QUEUE_PREFIX || 'silverstar';

let reportQueue = null;
if (Queue && process.env.REDIS_URL) {
  reportQueue = new Queue(QUEUE_NAME, process.env.REDIS_URL, {
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 50,
    },
    limiter: {
      max: parseInt(process.env.QUEUE_CONCURRENCY) || 5,
      duration: 1000,
    },
  });

  reportQueue.on('completed', (job) => {
    recordQueueJob();
    logger.info(`Queue job completed`, { jobId: job.id, name: job.name });
  });

  reportQueue.on('failed', (job, err) => {
    recordQueueJobFailed();
    logger.error(`Queue job failed`, { jobId: job.id, name: job.name, error: err.message });
  });
}

async function addJob(jobType, data, options = {}) {
  if (reportQueue) {
    const job = await reportQueue.add(jobType, data, {
      attempts: options.attempts ?? 3,
      backoff: { type: 'exponential', delay: 5000 },
      timeout: options.timeout ?? 300000,
      ...options,
    });
    const state = await job.getState();
    return {
      id: String(job.id),
      name: job.name,
      status: state,
      progress: 0,
      data: job.data,
    };
  }

  // In-memory fallback
  const id = String(++jobIdCounter);
  const jobEntry = {
    id,
    name: jobType,
    status: 'active',
    progress: 0,
    data,
    createdAt: new Date().toISOString(),
  };
  jobs.set(id, jobEntry);

  process.nextTick(async () => {
    try {
      const handler = jobHandlers[jobType];
      if (handler) {
        const result = await handler(data, (progress) => {
          jobEntry.progress = progress;
        });
        jobEntry.status = 'completed';
        jobEntry.result = result;
      } else {
        jobEntry.status = 'completed';
        jobEntry.result = null;
      }
    } catch (err) {
      jobEntry.status = 'failed';
      jobEntry.error = err.message;
      recordQueueJobFailed();
    }
    recordQueueJob();
  });

  return { id, name: jobType, status: 'active', progress: 0, data };
}

async function getJob(jobId) {
  if (reportQueue) {
    const job = await reportQueue.getJob(jobId);
    if (!job) return null;
    const state = await job.getState();
    const progress = await job.progress();
    const failedReason = job.failedReason;
    return {
      id: String(job.id),
      name: job.name,
      status: state === 'completed' ? 'completed' : state === 'failed' ? 'failed' : 'active',
      progress: typeof progress === 'number' ? progress : 0,
      result: job.returnvalue,
      error: failedReason,
      createdAt: job.timestamp,
      data: job.data,
    };
  }

  const job = jobs.get(jobId);
  if (!job) return null;
  return {
    id: job.id,
    name: job.name,
    status: job.status,
    progress: job.progress,
    result: job.result,
    error: job.error,
    createdAt: job.createdAt,
    data: job.data,
  };
}

async function getQueueStats() {
  if (reportQueue) {
    const [waiting, active, completed, failed] = await Promise.all([
      reportQueue.getWaitingCount(),
      reportQueue.getActiveCount(),
      reportQueue.getCompletedCount(),
      reportQueue.getFailedCount(),
    ]);
    return { waiting, active, completed, failed };
  }
  let waiting = 0, active = 0, completed = 0, failed = 0;
  for (const job of jobs.values()) {
    if (job.status === 'active') active++;
    else if (job.status === 'completed') completed++;
    else if (job.status === 'failed') failed++;
    else waiting++;
  }
  return { waiting, active, completed, failed };
}

const jobHandlers = {};

function registerHandler(jobType, handlerFn) {
  jobHandlers[jobType] = handlerFn;
}

module.exports = { addJob, getJob, getQueueStats, registerHandler };
