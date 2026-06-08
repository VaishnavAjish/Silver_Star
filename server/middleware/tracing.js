const { logger } = require('./logger');

let sdk = null;

async function initTelemetry(serviceName = 'silverstar-grow') {
  if (!process.env.OTEL_ENABLED || process.env.OTEL_ENABLED !== 'true') {
    logger.info('OpenTelemetry disabled (set OTEL_ENABLED=true to enable)');
    return null;
  }

  try {
    const { NodeSDK } = require('@opentelemetry/sdk-node');
    const { getNodeAutoInstrumentations } = require('@opentelemetry/instrumentation-http');
    const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
    const { PgInstrumentation } = require('@opentelemetry/instrumentation-pg');
    const { PrometheusExporter } = require('@opentelemetry/exporter-prometheus');
    const { Resource } = require('@opentelemetry/resources');
    const { SemanticResourceAttributes } = require('@opentelemetry/semantic-conventions');

    const prometheusExporter = new PrometheusExporter({
      port: parseInt(process.env.OTEL_METRICS_PORT) || 9464,
      endpoint: process.env.OTEL_METRICS_ENDPOINT || '/metrics',
    });

    sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: '2.0.0',
      }),
      traceExporter: process.env.OTEL_TRACE_EXPORTER
        ? new (require('@opentelemetry/exporter-otlp-http').OTLPTraceExporter)({
            url: process.env.OTEL_TRACE_URL || 'http://localhost:4318/v1/traces',
          })
        : undefined,
      metricReader: prometheusExporter,
      instrumentations: [
        getNodeAutoInstrumentations(),
        new ExpressInstrumentation(),
        new PgInstrumentation(),
      ],
    });

    await sdk.start();
    logger.info('OpenTelemetry initialized', { serviceName, metricsPort: 9464 });
    return sdk;
  } catch (err) {
    logger.warn('OpenTelemetry initialization failed (non-fatal)', { error: err.message });
    return null;
  }
}

async function shutdownTelemetry() {
  if (sdk) {
    try {
      await sdk.shutdown();
      logger.info('OpenTelemetry shut down');
    } catch (err) {
      logger.error('OpenTelemetry shutdown error', { error: err.message });
    }
  }
}

module.exports = { initTelemetry, shutdownTelemetry };
