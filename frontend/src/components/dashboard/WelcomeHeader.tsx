interface WelcomeHeaderProps {
  userName: string;
  tagline: string;
}

export function WelcomeHeader({ userName, tagline }: WelcomeHeaderProps) {
  return (
    <div className="">
      <h1 className="page-header">
        Hello, {userName}
      </h1>
      <p className="page-header-subtitle">
        {tagline}
      </p>
    </div>
  );
}
