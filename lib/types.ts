/** Union of all value types declared by an object type. */
export type ValueOf<T> = T[keyof T];
