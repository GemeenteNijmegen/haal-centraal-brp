import { Statics } from './Statics';

/**
 * Adds a configuration field to another interface
 */
export interface Configurable {
  configuration: Configuration;
}

/**
 * Environment object (required fields)
 */
export interface Environment {
  account: string;
  region: string;
}

/**
 * Basic configuration options per environment
 */
export interface Configuration {
  /**
   * Branch name for the applicible branch (this branch)
   */
  branch: string;

  /**
   * The pipeline will run from this environment
   *
   * Use this environment for your initial manual deploy
   */
  buildEnvironment: Environment;

  /**
   * Environment to deploy the application to
   *
   * The pipeline (which usually runs in the build account) will
   * deploy the application to this environment. This is usually
   * the workload AWS account in our default region.
   */
  deploymentEnvironment: Environment;

  /**
   * Dev-mode
   *
   * In dev-mode, we accept self-signed certificates, so this can never be active in prod!
   */
  devMode: boolean;

}


const EnvironmentConfigurations: {[key:string]: Configuration} = {
  development: {
    branch: 'development',
    buildEnvironment: Statics.gnBuildEnvironment,
    deploymentEnvironment: Statics.gnHaalCentraalBrpDevEnvironment,
    devMode: true,
  },
  acceptance: {
    branch: 'acceptance',
    buildEnvironment: Statics.gnBuildEnvironment,
    deploymentEnvironment: Statics.gnHaalCentraalBrpAccpEnvironment,
    devMode: false,
  },
  production: {
    branch: 'main',
    buildEnvironment: Statics.gnBuildEnvironment,
    deploymentEnvironment: Statics.gnHaalCentraalBrpProdEnvironment,
    devMode: false,
  },
};

/**
 * Retrieve a configuration object by passing a branch string
 *
 * **NB**: This retrieves the subobject with key `branchName`, not
 * the subobject containing the `branchName` as the value of the `branch` key
 *
 * @param branchName the branch for which to retrieve the environment
 * @returns the configuration object for this branch
 */
export function getEnvironmentConfiguration(branchName: string): Configuration {
  const conf = EnvironmentConfigurations[branchName];
  if (!conf) {
    throw Error(`No configuration found for branch ${branchName}`);
  }
  validateConfig(conf);
  return conf;
}

function validateConfig(config: Configuration) {
  if (config.devMode) {
    if (config.branch != 'development') {
      throw Error('Dev mode is not allowed for environments other than dev');
    }
  }
}