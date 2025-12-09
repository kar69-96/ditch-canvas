import { useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

interface UniversitySelectorProps {
  university: string;
  email: string;
  onUniversityChange: (university: string) => void;
  onEmailChange: (email: string) => void;
}

const universities = [
  "University of Colorado Boulder",
  "University of Colorado Denver",
  "University of Colorado Colorado Springs",
  "Colorado State University",
  "University of Denver",
  "Other",
];

export function UniversitySelector({
  university,
  email,
  onUniversityChange,
  onEmailChange,
}: UniversitySelectorProps) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-medium text-foreground">Select your university</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose your institution and enter your school email
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">University</label>
          <Select value={university} onValueChange={onUniversityChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a university" />
            </SelectTrigger>
            <SelectContent>
              {universities.map((uni) => (
                <SelectItem key={uni} value={uni}>
                  {uni}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">School Email</label>
          <Input
            type="email"
            placeholder="your.email@university.edu"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            className="w-full"
          />
        </div>
      </div>
    </div>
  );
}



