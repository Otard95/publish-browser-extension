import { Log } from '../utils/log';
import { AddonsApi, UploadDetails } from '../apis/addons-api';
import { sleep } from '../utils/sleep';
import { withTimeout } from '../utils/withTimeout';
import { plural } from '../utils/plural';

export interface FirefoxAddonStoreOptions {
  zip: string;
  sourcesZip?: string;
  extensionId: string;
  jwtIssuer: string;
  jwtSecret: string;
  channel: 'listed' | 'unlisted';
}

export class FirefoxAddonStore {
  readonly name = 'Firefox Addon Store';
  private api: AddonsApi;

  constructor(
    readonly options: FirefoxAddonStoreOptions,
    readonly deps: { log: Log },
  ) {
    this.api = new AddonsApi(options);
  }

  async publish(dryRun?: boolean): Promise<void> {
    const addon = await this.api.details({
      extensionId: this.wrappedExtensionId,
    });
    if (dryRun) {
      this.deps.log.warn('DRY RUN: Skipping upload and publish...');
      return;
    }

    // Firefox recommends 5-10s polling and a 10 minute timeout
    const pollInterval = 5e3; // 5 seconds
    const timeout = 10 * 60e3; // 10 minutes
    const uploadPromise = this.uploadAndPollValidation(pollInterval);
    const upload = await withTimeout(uploadPromise, timeout);

    console.log('Submitting new version...');
    const version = await this.api.versionCreate({
      extensionId: this.wrappedExtensionId,
      sourceFile: this.options.sourcesZip,
      uploadUuid: upload.uuid,
    });

    const validationUrl = `https://addons.mozilla.org/en-US/developers/addon/${addon.id}/file/${version.file.id}/validation`;
    const { errors, notices, warnings } = upload.validation;
    console.log(
      `Validation results: ${plural(errors, 'error')}, ${plural(
        warnings,
        'warning',
      )}, ${plural(notices, 'notice')}`,
    );
    if (!upload.valid) throw Error(`Extension is invalid: ${validationUrl}`);
    else console.log(`Validation results available at: ${validationUrl}`);
  }

  private async uploadAndPollValidation(
    pollIntervalMs: number,
  ): Promise<UploadDetails> {
    let details = await this.api.uploadCreate({
      file: this.options.zip,
      channel: this.options.channel,
    });

    console.log('Waiting for validation results...');
    while (!details.processed) {
      await sleep(pollIntervalMs);
      details = await this.api.uploadDetail(details);
    }

    return details;
  }

  /**
   * Ensure the extension id is wrapped in curly braces, that's what the addon store API is expecting
   * @example
   * "test" -> "{test}"
   */
  private get wrappedExtensionId(): string {
    let id = this.options.extensionId;
    if (!id.startsWith('{')) id = '{' + id;
    if (!id.endsWith('}')) id += '}';
    return id;
  }
}
