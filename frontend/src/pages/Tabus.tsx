import { useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { Bot, MessageSquare, Mail, BookOpen } from "lucide-react";

const Tabus = () => {
  const navigate = useNavigate();

  const features = [
    {
      icon: MessageSquare,
      title: "Direct Text Updates",
      description:
        "Stay informed with timely notifications about your assignments and coursework.",
      date: "Stay connected",
    },
    {
      icon: Mail,
      title: "TA Communication",
      description:
        "Automate your communication with teaching assistants and manage your academic correspondence.",
      date: "Save time",
    },
    {
      icon: BookOpen,
      title: "Personalized Studying",
      description:
        "Get customized study schedules tailored to your courses and learning preferences.",
      date: "Study smarter",
    },
  ];

  return (
    <Layout>
      <div className="min-h-screen flex items-center justify-center p-8 py-8">
        <div className="max-w-5xl w-full">
          <div className="text-center space-y-8">
            {/* Hero Section */}
            <div className="space-y-4">
              <div className="flex justify-center mb-4">
                <div className="w-20 h-20 rounded-full bg-foreground/10 flex items-center justify-center">
                  <Bot className="w-10 h-10 text-foreground" />
                </div>
              </div>
              <h1 className="text-4xl md:text-5xl font-bold leading-tight">
                Never miss another assignment
              </h1>
            </div>

            {/* Description Section */}
            <div className="space-y-4 max-w-2xl mx-auto">
              <h2 className="text-lg md:text-xl text-muted-foreground leading-relaxed">
                Tabus texts you directly to make sure you stay on track with
                your goals. Emails TAs, gives you personalized study plans, and
                so much more.
              </h2>
              <p className="text-base md:text-lg text-muted-foreground font-medium">
                Skip the busy work and get back to learning with Tabus
              </p>
            </div>

            {/* Features Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto pt-2 pb-6">
              {features.map((feature, index) => {
                const Icon = feature.icon;
                return (
                  <div
                    key={index}
                    className="flex flex-col rounded-xl border-2 border-border bg-background/50 backdrop-blur-sm px-6 py-6 space-y-4 h-full min-w-0"
                  >
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-foreground/10 p-2.5 flex-shrink-0">
                        <Icon className="w-5 h-5 text-foreground" />
                      </div>
                      <h3 className="text-lg font-semibold">{feature.title}</h3>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed flex-grow">
                      {feature.description}
                    </p>
                    <p className="text-xs text-muted-foreground font-medium mt-auto">
                      {feature.date}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* CTA Section */}
            <div className="space-y-4 pt-4">
              <p className="text-2xl md:text-3xl font-semibold">
                Join for $10/month
              </p>
              <button
                onClick={() => navigate("/assistant/signup")}
                className="relative inline-flex items-center justify-center text-lg font-medium px-12 py-7 h-auto border-2 border-foreground/20 bg-background text-foreground overflow-hidden group transition-colors duration-300 hover:text-background"
              >
                <span className="relative z-10">Sign up now</span>
                <span className="absolute inset-0 bg-foreground transform -translate-x-full group-hover:translate-x-0 transition-transform duration-300 ease-out"></span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Tabus;
