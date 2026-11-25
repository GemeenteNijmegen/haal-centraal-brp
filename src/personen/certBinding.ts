import * as crypto from 'crypto';
import { Logger } from '@aws-lambda-powertools/logger';
import { CloudWatchClient, PutMetricDataCommand, StandardUnit } from '@aws-sdk/client-cloudwatch';

const cloudwatch = new CloudWatchClient({ region: 'eu-central-1' });
const logger = new Logger({ serviceName: 'HaalCentraal' });

type MismatchReason = 'missing-cert' | 'empty-allowed-set' | 'no-match';

/**
 * Normalize a SHA-256 fingerprint to a canonical representation: lowercase hex without colons.
 * Applied to both the certificate-derived fingerprint and the operator-stored values so that
 * comparison is tolerant of colon/case formatting differences.
 * @param value Fingerprint string (e.g. 'AB:CD:...' or 'abcd...')
 * @returns Lowercase hex without colons
 */
export function normalizeFingerprint(value: string): string {
  return value.replace(/:/g, '').toLowerCase();
}

/**
 * Extract the client certificate PEM from the API Gateway mTLS event.
 * Returns undefined when no client certificate is present (devMode / execute-api).
 * @param event API Gateway proxy event
 * @returns The client certificate PEM string, or undefined when absent
 */
export function extractClientCertPem(event: any): string | undefined {
  return event?.requestContext?.identity?.clientCert?.clientCertPem;
}

/**
 * Compute the canonical SHA-256 fingerprint of a client certificate PEM.
 * @param clientCertPem PEM string of the leaf client certificate
 * @returns The normalized (lowercase, colon-free hex) fingerprint, or undefined when the PEM is missing/unparseable
 */
export function computeClientCertFingerprint(clientCertPem?: string): string | undefined {
  if (!clientCertPem) {
    return undefined;
  }
  try {
    const cert = new crypto.X509Certificate(clientCertPem);
    return normalizeFingerprint(cert.fingerprint256);
  } catch {
    logger.warn('Unable to parse client certificate PEM for binding check');
    return undefined;
  }
}

interface CertificateBindingArgs {
  fingerprint?: string;
  allowedFingerprints: string[];
  profileName: string;
  apiKeyId: string;
}

/**
 * Perform the LOG-ONLY certificate-to-API-key binding check.
 * On mismatch/missing (no cert, empty allowed set, or fingerprint not in the set) a structured
 * warning is logged and a CloudWatch metric is emitted, but the request is never blocked.
 * Never logs the raw API key or raw PEM. This function never throws.
 * @param args Computed fingerprint, allowed fingerprint set, profile name and apiKeyId
 * @returns Whether the client certificate fingerprint matches the allowed set
 */
export async function checkCertificateBinding(args: CertificateBindingArgs): Promise<boolean> {
  const { fingerprint, allowedFingerprints, profileName, apiKeyId } = args;

  const normalizedAllowed = allowedFingerprints.map(normalizeFingerprint);
  const match = !!fingerprint && normalizedAllowed.includes(fingerprint);

  if (match) {
    return true;
  }

  let reason: MismatchReason;
  if (!fingerprint) {
    reason = 'missing-cert';
  } else if (normalizedAllowed.length === 0) {
    reason = 'empty-allowed-set';
  } else {
    reason = 'no-match';
  }

  logger.warn('Certificate binding mismatch', {
    application: profileName,
    apiKeyId,
    reason,
    fingerprintPresent: !!fingerprint,
  });

  await emitMismatchMetric(profileName);

  return false;
}

/**
 * Emit the CloudWatch mismatch metric. Non-fatal: a metrics failure is swallowed so it never
 * breaks the request.
 * @param profileName Application profile name used as the metric dimension
 */
async function emitMismatchMetric(profileName: string): Promise<void> {
  try {
    await cloudwatch.send(new PutMetricDataCommand({
      Namespace: 'CertificateBinding',
      MetricData: [
        {
          MetricName: 'CertificateBindingMismatch',
          Dimensions: [
            {
              Name: 'Application',
              Value: profileName.substring(0, 255), // CloudWatch dimension value limit
            },
          ],
          Value: 1,
          Unit: StandardUnit.Count,
          Timestamp: new Date(),
        },
      ],
    }));
  } catch (error) {
    logger.error('Error sending certificate binding metric to CloudWatch', { error });
    // Don't throw to avoid breaking the main request
  }
}
