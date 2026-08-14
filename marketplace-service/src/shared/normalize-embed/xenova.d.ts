declare module '@xenova/transformers' {
  export function pipeline(
    task: 'feature-extraction',
    model: string,
  ): Promise<
    (
      text: string,
      opts: { pooling: 'mean'; normalize: boolean },
    ) => Promise<{ data: ArrayLike<number> }>
  >;
}
