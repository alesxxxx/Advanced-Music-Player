function getBuildEnv(name: string): string | undefined {
  const value = import.meta.env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  return value;
}

interface RuntimeEnvState {
  productName: string;
  enableSelfHostSetup: boolean;
}

const runtimeEnv: RuntimeEnvState = {
  productName: getBuildEnv("VITE_PRODUCT_NAME") ?? "AMP",
  enableSelfHostSetup: getBuildEnv("VITE_ENABLE_SELF_HOST_SETUP") === "true"
};

export function getAppEnv(): RuntimeEnvState {
  return { ...runtimeEnv };
}
