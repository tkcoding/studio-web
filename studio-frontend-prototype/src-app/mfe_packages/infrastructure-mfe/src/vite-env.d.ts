/// <reference types="vite/client" />

declare module '*.css?inline' {
  const css: string;
  export default css;
}

declare module '*.yaml?raw' {
  const text: string;
  export default text;
}
