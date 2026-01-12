import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import HoverSlatButton from "@/components/ui/hover-button";
import backgroundImage from "@/assets/backgrounds/dither_it_Gemini_Generated_Image_5vyi8z5vyi8z5vyi.png";

export default function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex flex-col relative">
      <div className="landing-background"></div>
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${backgroundImage})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      ></div>
      {/* Top right Log In button */}
      <div className="flex justify-end p-6 relative z-10">
        <Button onClick={() => navigate("/login")} variant="outline">
          Log In
        </Button>
      </div>

      {/* Hero text - positioned in top 2/3 of page */}
      <div className="absolute top-[15vh] left-1/2 transform -translate-x-1/2 relative z-10 text-center px-4">
        <h1 className="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-bold mb-4 sm:mb-4 whitespace-nowrap">
          Focus on{" "}
          <span className="italic bg-[hsl(40,30%,96%)] px-2">Learning</span>
        </h1>
        <h1 className="text-3xl sm:text-5xl md:text-6xl lg:text-7xl font-bold whitespace-nowrap">
          Not on <span className="italic">Canvas</span>
        </h1>
      </div>

      {/* Main content area */}
      <div className="flex-1 flex items-center justify-center relative z-10">
        <div className="text-center">
          {/* Add your landing page content here */}
        </div>
      </div>

      {/* Join Now button - adjust bottom value to move higher (increase) or lower (decrease) */}
      <div className="absolute bottom-[16vh] left-1/2 -translate-x-1/2 relative z-10 flex justify-center">
        <HoverSlatButton
          onClick={() => navigate("/onboarding/info")}
          initialText="JOIN"
          className="scale-[1.6]"
        />
      </div>
    </div>
  );
}
