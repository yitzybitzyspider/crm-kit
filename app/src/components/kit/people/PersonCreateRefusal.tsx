// When the database refuses to save a new person (a duplicate name or contact
// detail, a teammate with no handle), its sentence is shown beside the form
// and the form keeps what was typed. Wraps upstream's CreateBase.
import { CreateBase, type CreateBaseProps } from "ra-core";
import { createContext, useContext, useState } from "react";

const RefusalContext = createContext<string | null>(null);

const refusalText = (error: unknown) =>
  typeof error === "string"
    ? error
    : ((error as { message?: string })?.message ?? "The person was not saved");

export const PersonCreateBase = ({
  transform,
  mutationOptions,
  ...props
}: CreateBaseProps) => {
  const [refusal, setRefusal] = useState<string | null>(null);

  return (
    <RefusalContext.Provider value={refusal}>
      <CreateBase
        {...props}
        // runs at the start of every save: the last refusal is cleared
        transform={(data, options) => {
          setRefusal(null);
          return transform ? transform(data, options) : data;
        }}
        mutationOptions={
          {
            ...mutationOptions,
            onError: (error: unknown) => setRefusal(refusalText(error)),
          } as CreateBaseProps["mutationOptions"]
        }
      />
    </RefusalContext.Provider>
  );
};

export const PersonCreateRefusal = () => {
  const refusal = useContext(RefusalContext);
  if (!refusal) return null;
  return (
    <p
      role="alert"
      className="mt-4 rounded-md border border-destructive px-3 py-2 text-sm text-destructive"
    >
      {refusal}
    </p>
  );
};
