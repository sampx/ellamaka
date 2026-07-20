import { type ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <img
      data-component="logo-mark"
      src="/favicon-96x96-v3.png?v=4"
      classList={{ "object-contain": true, [props.class ?? ""]: !!props.class }}
      alt="Ellamaka Icon"
    />
  )
}

export const Splash = (props: Pick<ComponentProps<"div">, "ref" | "class">) => {
  return (
    <div
      ref={props.ref}
      data-component="logo-splash"
      classList={{ "flex flex-col items-center justify-center gap-3": true, [props.class ?? ""]: !!props.class }}
    >
      <img src="/favicon-96x96-v3.png?v=4" class="h-12 w-12 object-contain" alt="Ellamaka Mark" />
      <img src="/ellamaka-text-logo.png?v=2" class="h-7 w-auto object-contain ellamaka-logo-invert" alt="Ellamaka Logo" />
    </div>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <img
      data-component="logo-text"
      src="/ellamaka-text-logo.png?v=2"
      classList={{ "object-contain ellamaka-logo-invert": true, [props.class ?? ""]: !!props.class }}
      alt="Ellamaka Logo"
    />
  )
}

