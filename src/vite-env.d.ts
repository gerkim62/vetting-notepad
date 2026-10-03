/// <reference types="vite/client" />

declare module '*.css';
declare module '*?inline' {
  const content: string;
  export default content;
}
