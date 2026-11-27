// The three inputs a touch has on top of upstream's note: channel, next step
// and its due date. Mounted inside upstream's note form (notes/NoteInputs.tsx).
import { required } from "ra-core";
import { useEffect } from "react";
import { useFormContext, useFormState, useWatch } from "react-hook-form";
import { DateInput } from "@/components/admin/date-input";
import { SelectInput } from "@/components/admin/select-input";
import { TextInput } from "@/components/admin/text-input";
import { cn } from "@/lib/utils";

import { touchChannels } from "./statuses";

const channelRequired = required();

export const TouchInputs = ({ className }: { className?: string }) => {
  const { control, getValues, setValue } = useFormContext();
  const nextStep = useWatch({ control, name: "next_step" });
  const hasNextStep = typeof nextStep === "string" && nextStep.trim() !== "";
  const { errors } = useFormState({ control, name: "channel" });

  // A due date belongs to a next step: with none, there is none.
  useEffect(() => {
    if (!hasNextStep && getValues("next_due")) {
      setValue("next_due", null, { shouldDirty: true });
    }
  }, [hasNextStep, getValues, setValue]);

  return (
    <div
      className={cn("grid grid-cols-1 md:grid-cols-3 gap-4", className)}
      data-testid="touch-inputs"
    >
      <div>
        <SelectInput
          source="channel"
          label="Channel"
          choices={touchChannels}
          validate={channelRequired}
          helperText={false}
        />
        {/* upstream's select input draws no message of its own */}
        {errors.channel ? (
          <p role="alert" className="text-destructive text-sm mt-1">
            A touch needs a channel
          </p>
        ) : null}
      </div>
      <TextInput source="next_step" label="Next step" helperText={false} />
      {/* not "Due date": upstream's task form on the same page has that label */}
      <DateInput
        source="next_due"
        label="Due by"
        helperText={false}
        disabled={!hasNextStep}
      />
    </div>
  );
};
