/** Ported from reference/lighting-survey-reader.html (vocabulary), extended with non-health facility types. */
export const SPACE_TYPES = ["OFFICE","CLINIC","TOILET","STORE","LOBBY","LAB","IT ROOM","ELE ROOM","PUMP ROOM","KITCHEN","BED ROOM","MEETING ROOM","PHARMACY","RECEPTION","WAITING AREA","STAIR CASE","MOSQUE","SERVICE","WORKSHOP","ROOF","OUT SIDE","EXTERNAL AREA","GARDEN AREA","PATIENT ROOM","OPERATION THEATRE","ICU","WARD","LAUNDRY","MORTUARY","PARKING",
  "CLASSROOM","LIBRARY","HALL","SHOP","FACTORY","DINING AREA"] as const;
export const UNIT_TYPES = ["2FT","4FT","60X60 PANEL","59.5X59.5 PANEL","4FT PANEL","DOWN LIGHT","DOWN LIGHT SQUARE","DOWN SPOT","FLOOD LIGHT","POLE LIGHT","POST LIGHT","BOLLARD","WALL MOUNTED","STRIP LIGHT","LED BULB","GLOBE TYPE","CYLINDER TYPE","CHANDELIER","DECORATIVE","EXIT SIGN","HIGH BAY"] as const;
export const LAMP_TYPES = ["T8","T5","PANEL","LED","SQUARE LED","CFL-E27","BULB-E27","E27","E14","DULUX 4PIN","METAL HALIDE-E40","HQL-E40","SPOT LIGHT","LED STRIP","DOUBLE ENDED","HALOGEN"] as const;

/** Dropdown values of the Excel template (normalised; the template's own list has typos such as "Emergncy"). */
export const ENUMS = {
  led: ["LED", "Non-LED"],
  normal_emergency: ["Normal", "Emergency"],
  color_temp: ["3000K", "3500K", "4000K", "5000K", "6500K"],
  int_ext: ["Internal", "External"],
  mounted: ["Surface", "Recessed", "Wall-Mounted", "Suspended", "Floor Mounted"],
  dimmable: ["Yes", "No"],
  sensors: ["Yes", "No"],
  ceiling: ["No Ceiling", "Gypsum", "Panel", "Others"],
  switch_status: ["Good", "To be replaced", "No Switch", "Not Working"],
} as const;
