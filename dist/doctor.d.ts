export interface DoctorCheck {
    name: string;
    ok: boolean;
    detail: string;
}
export declare function runDoctor(root: string): Promise<DoctorCheck[]>;
