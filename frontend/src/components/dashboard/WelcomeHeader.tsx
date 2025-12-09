interface WelcomeHeaderProps {
  firstName: string;
  tagline: string;
}

export function WelcomeHeader({ firstName, tagline }: WelcomeHeaderProps) {
  return (
    <div className="">
      <h1 className="page-header">
        Hi, {firstName}
      </h1>
      <p className="page-header-subtitle">
        {tagline}
      </p>
    </div>
  );
}
