"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { serverTimestamp } from "firebase/firestore";

import { createEvent } from "@/lib/db/event";

import { Button } from "@/components/ui/button";
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

const eventFormSchema = z.object({
    name: z.string().min(1, "Name is required"),
    description: z.string().min(1, "Description is required"),
    capacity: z.number().int().min(1, "Capacity must be at least 1"),
    expectedGuests: z.number().int().min(0, "Expected guests cannot be negative"),
    formPath: z.string().min(1, "Form path is required"),
    invoicePath: z.string().min(1, "Invoice path is required"),
    organizationPath: z.string().min(1, "Organization path is required"),
    timezone: z.string().min(1, "Timezone is required"),
    allowOverlap: z.boolean(),
    status: z.enum(["Draft", "Published"]),
    pageMode: z.enum(["default", "custom", "redirect"]).default("default"),
    redirectUrl: z.string().default(""),
});

type EventFormValues = z.infer<typeof eventFormSchema>;
type EventFormInput = z.input<typeof eventFormSchema>;

export default function EventFormTest() {
    const form = useForm<EventFormInput, undefined, EventFormValues>({
        resolver: zodResolver(eventFormSchema),
        defaultValues: {
            name: "",
            description: "",
            capacity: 1,
            expectedGuests: 0,
            formPath: "",
            invoicePath: "",
            organizationPath: "",
            timezone: "Asia/Singapore",
            allowOverlap: false,
            status: "Draft",
            pageMode: "default",
            redirectUrl: "",
        },
    });

    const isSubmitting = form.formState.isSubmitting;

    async function onSubmit(values: EventFormValues) {
        try {
            const id = await createEvent({
                ...values,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                periods: [],
            });

            console.log("Created event:", id);
            alert(`Created event: ${id}`);
            form.reset();
        } catch (error) {
            console.error(error);
            alert("Failed to create event");
        }
    }

    return (
        <div className="max-w-2xl rounded-xl border p-6 space-y-6">
            <div>
                <h2 className="text-xl font-semibold">Create Event Test</h2>
                <p className="text-sm text-muted-foreground">
                    Simple test form for Firestore event creation.
                </p>
            </div>

            <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                    <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Event Name</FormLabel>
                                <FormControl>
                                    <Input placeholder="Tech Meetup 2026" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <FormField
                        control={form.control}
                        name="description"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Description</FormLabel>
                                <FormControl>
                                    <Textarea placeholder="Describe the event" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                        <FormField
                            control={form.control}
                            name="capacity"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Capacity</FormLabel>
                                    <FormControl>
                                        <Input
                                            type="number"
                                            {...field}
                                            onChange={(e) => field.onChange(e.target.valueAsNumber)}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="expectedGuests"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Expected Guests</FormLabel>
                                    <FormControl>
                                        <Input
                                            type="number"
                                            {...field}
                                            onChange={(e) => field.onChange(e.target.valueAsNumber)}
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>

                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                        <FormField
                            control={form.control}
                            name="formPath"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Form Path</FormLabel>
                                    <FormControl>
                                        <Input placeholder="/forms/event-a" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="invoicePath"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Invoice Path</FormLabel>
                                    <FormControl>
                                        <Input placeholder="/invoices/event-a" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>

                    <FormField
                        control={form.control}
                        name="organizationPath"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Organization Path</FormLabel>
                                <FormControl>
                                    <Input placeholder="/organizations/acme" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />

                    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                        <FormField
                            control={form.control}
                            name="timezone"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Timezone</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Asia/Singapore" {...field} />
                                    </FormControl>
                                    <FormDescription>
                                        Example: Asia/Singapore
                                    </FormDescription>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="status"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Status</FormLabel>
                                    <FormControl>
                                        <select
                                            className="flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm"
                                            value={field.value}
                                            onChange={field.onChange}
                                        >
                                            <option value="Draft">Draft</option>
                                            <option value="Published">Published</option>
                                        </select>
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>

                    <FormField
                        control={form.control}
                        name="allowOverlap"
                        render={({ field }) => (
                            <FormItem className="flex items-center justify-between rounded-lg border p-4">
                                <div className="space-y-1">
                                    <FormLabel>Allow Overlap</FormLabel>
                                    <FormDescription>
                                        Whether event periods are allowed to overlap.
                                    </FormDescription>
                                </div>
                                <FormControl>
                                    <Switch
                                        checked={field.value}
                                        onCheckedChange={field.onChange}
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />

                    <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting ? "Saving..." : "Create Event"}
                    </Button>
                </form>
            </Form>
        </div>
    );
}
