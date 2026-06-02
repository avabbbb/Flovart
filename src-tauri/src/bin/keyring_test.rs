fn main() {
    println!("{:?}", std::mem::size_of::<keyring::Error>());
    let _builder = keyring::default::default_credential_builder();
    let c: keyring::Credential = _builder
        .build(None, "com.flovart.desktop", "test")
        .expect("build");
    println!("{:?}", c);
}
